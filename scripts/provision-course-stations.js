const fs = require("node:fs");
const path = require("node:path");
const { Contract, JsonRpcProvider, NonceManager, Wallet, id, parseEther } = require("ethers");
const { courseChainId, readCourseAccounts, readDeployment } = require("./course-config");
const { abi } = require("../frontend/src/abi/EVTrustRegistry.json");
const [firstStation, ...additionalStations] = require("../frontend/src/courseStationDids.json");

const keysPath = path.join(__dirname, "..", ".local-chain", "station-accounts.json");

function readStationKeys() {
  if (!fs.existsSync(keysPath)) {
    const keys = Object.fromEntries(additionalStations.map((did) => [did, Wallet.createRandom().privateKey]));
    fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  return JSON.parse(fs.readFileSync(keysPath, "utf8"));
}

async function main() {
  const deployment = readDeployment();
  if (deployment.mode !== "course") throw new Error("Deploy the private Besu workspace before provisioning stations.");
  const rpc = new URL(deployment.rpcUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname)) throw new Error("Use the local Besu RPC.");
  const provider = new JsonRpcProvider(rpc.href, undefined, { cacheTimeout: -1 });
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(courseChainId)) throw new Error("Unexpected chain ID.");
    const accounts = readCourseAccounts();
    const registrar = new NonceManager(new Wallet(accounts.admin, provider));
    const registry = new Contract(deployment.address, abi, registrar);
    if (!await registry.hasRole(await registry.REGISTRAR_ROLE(), await registrar.getAddress())) {
      throw new Error("The local admin wallet does not have the registrar role.");
    }
    const first = await registry.entities(id(firstStation));
    if (!first.registered || !first.isStation || await registry.revoked(id(firstStation))) {
      throw new Error(`The original station ${firstStation} is unavailable.`);
    }

    const stationKeys = readStationKeys();
    const stations = await Promise.all(additionalStations.map(async (did) => {
      const hash = id(did);
      const entity = await registry.entities(hash);
      if (entity.registered) {
        if (!entity.isStation || await registry.revoked(hash)) throw new Error(`${did} is registered as an inactive or different entity.`);
        const ownWallet = new Wallet(stationKeys[did]).address === entity.pubKey;
        return { did, hash, address: entity.pubKey, registered: true, ownWallet };
      }
      return { did, hash, address: new Wallet(stationKeys[did]).address, registered: false, ownWallet: true };
    }));
    const funding = parseEther("0.1");
    const pending = [];
    for (const station of stations) {
      if (!station.registered) pending.push(await registry.register(station.hash, station.address, true));
      if (station.ownWallet) {
        const balance = await provider.getBalance(station.address);
        if (balance < funding) pending.push(await registrar.sendTransaction({ to: station.address, value: funding - balance }));
      }
    }
    await Promise.all(pending.map((tx) => tx.wait(1, 120000)));
    for (const station of stations) {
      const entity = await registry.entities(station.hash);
      if (!entity.registered || !entity.isStation || entity.pubKey !== station.address) {
        throw new Error(`Registration verification failed for ${station.did}.`);
      }
    }
    console.log(`Verified ${stations.length + 1} station identities on Besu chain ${courseChainId}.`);
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
