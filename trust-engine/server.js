const express = require("express");
const { ethers } = require("ethers");
const { TrustEngine } = require("./trustEngine");
const { connectMongo, MongoReputationStore } = require("./mongoStore");
const { LedgerRecords } = require("./ledgerRecords");
const { registerOpenChargeMap } = require("./openChargeMap");
const { registryAbi, RPC_URL, ORACLE_PRIVATE_KEY, REGISTRY_ADDRESS, PORT, ALLOWED_ORIGIN, COURSE_MODE, DEPLOYMENT_BLOCK } = require("./config");

function buildApp({ store, db } = {}) {
  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 });
  const oracleWallet = COURSE_MODE ? null : new ethers.Wallet(ORACLE_PRIVATE_KEY, provider);
  const registry = new ethers.Contract(REGISTRY_ADDRESS, registryAbi, oracleWallet ?? provider);
  const engine = COURSE_MODE ? null : new TrustEngine(registry, store ?? (db ? new MongoReputationStore(db) : undefined));
  const ledger = db ? new LedgerRecords(db, registry, DEPLOYMENT_BLOCK) : null;

  const app = express();
  app.locals.ledger = ledger;
  app.locals.provider = provider;
  const allowedOrigins = new Set(ALLOWED_ORIGIN.split(",").map((origin) => origin.trim()));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.vary("Origin");
    if (origin) {
      if (!allowedOrigins.has(origin)) {
        return res.status(403).json({ error: "Origin is not allowed" });
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json());
  registerOpenChargeMap(app, db);
  app.use((req, res, next) => {
    if (COURSE_MODE && req.method === "POST") {
      return res.status(405).json({ error: "Submit signed transactions to the Besu registry." });
    }
    next();
  });

  // All transactions share one signer. Serialize writes through confirmation.
  let writeTail = Promise.resolve();
  function postWrite(route, handler) {
    app.post(route, (req, res, next) => {
      const write = writeTail.then(() => handler(req, res));
      writeTail = write.catch(() => {});
      write.catch(next);
    });
  }

  const isHash = (value) => ethers.isHexString(value, 32);
  const isDemoChain = async () => {
    const { hostname } = new URL(RPC_URL);
    return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
      && (await provider.getNetwork()).chainId === 31337n;
  };

  app.get("/health", async (req, res) => {
    try {
      await Promise.all([registry.requiredApprovals(), db?.command({ ping: 1 })]);
      res.json({ status: "ok", registry: REGISTRY_ADDRESS, database: db ? "mongodb" : null,
        ...(oracleWallet && { oracle: oracleWallet.address }) });
    } catch {
      res.status(503).json({ status: "unavailable", error: "The registry or database is unreachable" });
    }
  });

  for (const [route, collection] of [
    ["/records/events", ledger?.events],
    ["/records/sessions", ledger?.sessions],
    ["/records/entities", ledger?.entities],
    ["/records/proposals", ledger?.proposals]
  ]) {
    app.get(route, async (req, res, next) => {
      const limit = Number(req.query.limit ?? 50);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ error: "Limit must be between 1 and 100" });
      }
      const filter = {};
      if (route === "/records/sessions") {
        for (const field of ["evId", "stationId", "sessionId"]) {
          if (req.query[field] === undefined) continue;
          if (!isHash(req.query[field])) return res.status(400).json({ error: "Expected a 32-byte hash" });
          filter[field] = req.query[field].toLowerCase();
        }
      }
      try {
        const result = collection && await ledger.read(collection, filter, limit);
        if (!result) return res.status(503).json({ error: "Ledger index is unavailable or still starting" });
        res.json({ registry: REGISTRY_ADDRESS, ...result });
      } catch (error) {
        next(error);
      }
    });
  }

  // Webhook fired by the settlement service once a charging session closes.
  postWrite("/session-closed", async (req, res) => {
    const { didHash, sessionSucceeded } = req.body;
    if (!isHash(didHash) || typeof sessionSucceeded !== "boolean") {
      return res.status(400).json({ error: "A 32-byte didHash and boolean sessionSucceeded are required" });
    }
    try {
      const result = await engine.onSessionClosed(didHash, sessionSucceeded);
      res.json({
        scoreE4: result.scoreE4,
        txHash: result.txHash,
        proposalId: result.proposalId,
        executed: result.executed,
        approvals: result.approvals,
        requiredApprovals: result.requiredApprovals
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook fired to finalize an authenticated charging session between an EV and a Station.
  // Recomputes Beta reputation for both parties and proposes score updates on-chain.
  postWrite("/session/complete", async (req, res) => {
    const { sessionId, txHash, evDidHash, stationDidHash, evSucceeded = true, stationSucceeded = true, energyKWh, durationSeconds } = req.body;
    if (![sessionId, evDidHash, stationDidHash].every(isHash)
        || (txHash !== undefined && !isHash(txHash))
        || typeof evSucceeded !== "boolean" || typeof stationSucceeded !== "boolean"
        || (energyKWh !== undefined && (!Number.isFinite(energyKWh) || energyKWh < 0))
        || (durationSeconds !== undefined && (!Number.isSafeInteger(durationSeconds) || durationSeconds < 0))) {
      return res.status(400).json({ error: "Invalid session ID, participant hashes, outcome, or meter reading" });
    }
    try {
      const registryAddress = REGISTRY_ADDRESS.toLowerCase();
      const receipt = txHash && await provider.getTransactionReceipt(txHash);
      const events = txHash
        ? (receipt?.logs ?? []).filter((log) => log.address.toLowerCase() === registryAddress)
          .map((log) => registry.interface.parseLog(log))
        : await registry.queryFilter(registry.filters.SessionAuthenticated(evDidHash, stationDidHash));
      const authorized = events.some((event) =>
        (event?.name ?? event?.fragment?.name) === "SessionAuthenticated"
          && event.args.sessionId.toLowerCase() === sessionId.toLowerCase()
          && event.args.evId.toLowerCase() === evDidHash.toLowerCase()
          && event.args.stationId.toLowerCase() === stationDidHash.toLowerCase());
      if (!authorized) return res.status(409).json({ error: "No matching authorized session on the registry" });

      const sessionKey = sessionId.toLowerCase();
      const settlement = await engine.store.withLock(`session:${sessionKey}`, (previous) => {
        if (!previous) return {
          sessionId: sessionKey, evDidHash: evDidHash.toLowerCase(), stationDidHash: stationDidHash.toLowerCase(),
          txHash, evSucceeded, stationSucceeded, energyKWh, durationSeconds
        };
        if (previous.evSucceeded !== evSucceeded || previous.stationSucceeded !== stationSucceeded) {
          throw Object.assign(new Error("This session already has a different outcome"), { status: 409 });
        }
        return null;
      });
      const evResult = await engine.onSessionClosed(evDidHash, settlement.evSucceeded, sessionKey);
      const stationResult = await engine.onSessionClosed(stationDidHash, settlement.stationSucceeded, sessionKey);
      res.json({
        sessionId,
        energyKWh: settlement.energyKWh,
        durationSeconds: settlement.durationSeconds,
        ev: {
          didHash: evDidHash,
          scoreE4: evResult.scoreE4,
          proposalId: evResult.proposalId,
          executed: evResult.executed,
          approvals: evResult.approvals,
          requiredApprovals: evResult.requiredApprovals
        },
        station: {
          didHash: stationDidHash,
          scoreE4: stationResult.scoreE4,
          proposalId: stationResult.proposalId,
          executed: stationResult.executed,
          approvals: stationResult.approvals,
          requiredApprovals: stationResult.requiredApprovals
        }
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Reports provable misbehavior, triggering a direct slash proposal.
  postWrite("/misbehavior", async (req, res) => {
    const { didHash, penaltyE4 } = req.body;
    if (!isHash(didHash) || !Number.isInteger(penaltyE4) || penaltyE4 < 1 || penaltyE4 > 10000) {
      return res.status(400).json({ error: "A 32-byte didHash and an integer penalty from 1 to 10000 are required" });
    }
    try {
      const result = await engine.onMisbehaviorProven(didHash, penaltyE4);
      res.json({
        txHash: result.txHash,
        proposalId: result.proposalId,
        executed: result.executed,
        approvals: result.approvals
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/entities/:didHash", async (req, res) => {
    if (!isHash(req.params.didHash)) return res.status(400).json({ error: "A 32-byte didHash is required" });
    try {
      const entity = await registry.entities(req.params.didHash);
      res.json({
        registered: entity.registered,
        isStation: entity.isStation,
        pubKey: entity.pubKey,
        trustScoreE4: entity.trustScoreE4.toString(),
        sessionsTotal: entity.sessionsTotal.toString(),
        sessionsFailed: entity.sessionsFailed.toString(),
        lastUpdated: entity.lastUpdated.toString()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Local development faucet: funds connected web console wallets with test ETH
  // and grants DEFAULT_ADMIN_ROLE, REGISTRAR_ROLE, and ORACLE_ROLE.
  postWrite("/faucet", async (req, res) => {
    const { address } = req.body;
    if (!ethers.isAddress(address) || address === ethers.ZeroAddress) {
      return res.status(400).json({ error: "valid Ethereum address required" });
    }
    try {
      if (!await isDemoChain()) return res.status(403).json({ error: "Faucet is available on the local Hardhat chain only" });
      const bal = await provider.getBalance(address);
      let funded = false;
      if (bal < ethers.parseEther("2.0")) {
        const tx = await oracleWallet.sendTransaction({
          to: address,
          value: ethers.parseEther("25.0")
        });
        await tx.wait();
        funded = true;
      }

      const adminRole = await registry.DEFAULT_ADMIN_ROLE();
      const registrarRole = await registry.REGISTRAR_ROLE();
      const oracleRole = await registry.ORACLE_ROLE();

      const [hasAdmin, hasRegistrar, hasOracle] = await Promise.all([
        registry.hasRole(adminRole, address),
        registry.hasRole(registrarRole, address),
        registry.hasRole(oracleRole, address)
      ]);

      if (!hasAdmin) {
        const tx = await registry.grantRole(adminRole, address);
        await tx.wait();
      }
      if (!hasRegistrar) {
        const tx = await registry.grantRole(registrarRole, address);
        await tx.wait();
      }
      if (!hasOracle) {
        const tx = await registry.grantRole(oracleRole, address);
        await tx.wait();
      }

      res.json({
        success: true,
        address,
        funded,
        rolesGranted: { admin: !hasAdmin, registrar: !hasRegistrar, oracle: !hasOracle }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Direct registration endpoint using registrar key for MetaMask accounts
  postWrite("/register-entity", async (req, res) => {
    const { didHash, pubKey, isStation } = req.body;
    if (!isHash(didHash) || !ethers.isAddress(pubKey) || pubKey === ethers.ZeroAddress || typeof isStation !== "boolean") {
      return res.status(400).json({ error: "didHash, pubKey, and isStation boolean required" });
    }
    try {
      const existing = await registry.entities(didHash);
      if (existing.registered) {
        if (existing.pubKey.toLowerCase() !== pubKey.toLowerCase() || existing.isStation !== isStation) {
          return res.status(409).json({ error: "DID is already registered to a different wallet or entity type" });
        }
        return res.json({ alreadyRegistered: true, didHash, pubKey: existing.pubKey, isStation: existing.isStation });
      }
      const tx = await registry.register(didHash, pubKey, isStation);
      const receipt = await tx.wait();
      res.json({ success: true, didHash, pubKey, isStation, txHash: receipt.hash });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Automated station countersign helper for network-managed charging stations (e.g. did:station:001)
  app.post("/station/countersign", async (req, res) => {
    const { evId, stationId, nonce } = req.body;
    if (![evId, stationId, nonce].every(isHash)) {
      return res.status(400).json({ error: "evId, stationId, nonce required" });
    }
    try {
      if (!await isDemoChain()) return res.status(404).json({ error: "No automated station on this chain" });
      const mnemonic = ethers.Mnemonic.fromPhrase("test test test test test test test test test test test junk");
      const stationWallet = ethers.HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/1");
      const station = await registry.entities(stationId);
      if (!station.registered || !station.isStation || station.pubKey !== stationWallet.address) {
        return res.status(404).json({ error: "Station requires an operator countersignature" });
      }
      const network = await provider.getNetwork();
      const digest = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "address", "uint256"],
        [evId, stationId, nonce, REGISTRY_ADDRESS, network.chainId]
      );
      const stationSig = await stationWallet.signMessage(ethers.getBytes(digest));
      res.json({ stationSig, stationSigner: stationWallet.address });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Relayer endpoint for on-chain session authentication (submits mutual signatures with zero gas required from user)
  postWrite("/session/authenticate", async (req, res) => {
    const { evId, stationId, nonce, evSig, stationSig } = req.body;
    if (![evId, stationId, nonce].every(isHash) || !ethers.isHexString(evSig, 65) || !ethers.isHexString(stationSig, 65)) {
      return res.status(400).json({ error: "evId, stationId, nonce, evSig, stationSig required" });
    }
    try {
      const tx = await registry.authenticateSession(evId, stationId, nonce, evSig, stationSig);
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log) => {
          try { return registry.interface.parseLog(log); } catch { return null; }
        })
        .find((p) => p && (p.name === "SessionAuthenticated" || p.name === "SessionDenied"));

      if (!event) throw new Error("Registry did not emit a session result");
      res.json({
        success: true,
        authorized: event.name === "SessionAuthenticated",
        sessionId: event.args.sessionId,
        txHash: receipt.hash
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.status === 400 ? "Invalid JSON body" : err.message });
  });

  return app;
}

async function start() {
  const { client, db } = await connectMongo();
  try {
    const store = new MongoReputationStore(db);
    const imported = await store.importLegacy();
    if (imported) console.log(`Imported ${imported} legacy reputation records into MongoDB.`);
    const app = buildApp({ store, db });
    const server = app.listen(PORT, "127.0.0.1", () => console.log(`Trust engine with MongoDB listening on http://127.0.0.1:${PORT}`));
    let task;
    let timer;
    let stopping = false;
    function sync() {
      task = app.locals.ledger.sync()
        .catch((error) => console.error("Ledger indexing will retry:", error.shortMessage || error.message))
        .finally(() => { if (!stopping) timer = setTimeout(sync, 3000); });
    }
    async function close() {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      const closed = new Promise((resolve) => server.close(resolve));
      await Promise.all([closed, task]);
      app.locals.provider.destroy();
      await client.close();
    }
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
      close().catch(console.error);
    });
    process.on("SIGINT", () => close().catch(console.error));
    process.on("SIGTERM", () => close().catch(console.error));
    sync();
  } catch (error) {
    await client.close();
    throw error;
  }
}

if (require.main === module) start().catch((error) => {
  console.error("Could not start the trust engine with MongoDB:", error.name);
  process.exitCode = 1;
});

module.exports = { buildApp };
