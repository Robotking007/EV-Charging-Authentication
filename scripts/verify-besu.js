const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { setTimeout: delay } = require("node:timers/promises");
const { AbiCoder, Contract, JsonRpcProvider, NonceManager, Wallet, ZeroHash, getBytes, id, keccak256, randomBytes, solidityPackedKeccak256 } = require("ethers");
const { courseChainId, courseDids, readCourseAccounts, readDeployment, validatorRpc } = require("./course-config");
const { abi } = require("../artifacts/contracts/EVTrustRegistry.sol/EVTrustRegistry.json");

async function main() {
  const deployment = readDeployment();
  assert.equal(deployment.mode, "course", "Run npm run besu:deploy first.");
  const provider = new JsonRpcProvider(validatorRpc(), undefined, { cacheTimeout: -1, pollingInterval: 250 });
  try {
    const { chainId } = await provider.getNetwork();
    assert.equal(chainId, BigInt(courseChainId));
    const validators = await provider.send("ibft_getValidatorsByBlockNumber", ["latest"]);
    assert.equal(validators.length, 4);
    const accounts = readCourseAccounts();
    const ev = new Wallet(accounts.ev, provider);
    const station = new Wallet(accounts.station, provider);
    const registry = new Contract(deployment.address, abi, ev);
    const evId = id(courseDids.ev);
    const stationId = id(courseDids.station);
    const evBefore = await registry.entities(evId);
    const stationBefore = await registry.entities(stationId);
    const evBalanceBefore = await registry.withdrawable(ev.address);
    const stationBalanceBefore = await registry.withdrawable(station.address);
    const measurements = {};

    async function measure(label, send) {
      const start = performance.now();
      const receipt = await (await send()).wait();
      measurements[label] = {
        txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
        confirmationMs: Math.round(performance.now() - start)
      };
      return receipt;
    }

    const nonce = randomBytes(32);
    const challenge = getBytes(solidityPackedKeccak256(
      ["bytes32", "bytes32", "bytes32", "address", "uint256"],
      [evId, stationId, nonce, deployment.address, chainId]
    ));
    const [evSig, stationSig] = await Promise.all([ev.signMessage(challenge), station.signMessage(challenge)]);
    const authorization = await measure("authenticateSession", () => registry.authenticateSession(evId, stationId, nonce, evSig, stationSig));
    const auth = authorization.logs.map((log) => registry.interface.parseLog(log)).find((log) => log?.name === "SessionAuthenticated");
    assert.ok(auth, "Session was denied. Check the EV and station trust scores.");
    const { sessionId } = auth.args;

    const maxWh = 1000n;
    const pricePerWh = 10000000000000n;
    const energyWh = 380n;
    const expiresAt = (await provider.getBlock("latest")).timestamp + 600;
    await measure("fundSession", () => registry.fundSession(sessionId, maxWh, pricePerWh, expiresAt, { value: maxWh * pricePerWh }));
    const meter = getBytes(keccak256(AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint64", "uint64", "uint256", "uint64", "address", "uint256"],
      [sessionId, energyWh, maxWh, pricePerWh, expiresAt, deployment.address, chainId]
    )));
    const [evMeter, stationMeter] = await Promise.all([ev.signMessage(meter), station.signMessage(meter)]);
    const settled = await measure("settleSession", () => registry.settleSession(sessionId, energyWh, evMeter, stationMeter));
    assert.equal((await registry.chargingSessions(sessionId)).paymentState, 2n);
    const paid = energyWh * pricePerWh;
    const evRefund = (maxWh - energyWh) * pricePerWh;
    assert.equal(await registry.withdrawable(station.address), stationBalanceBefore + paid);
    assert.equal(await registry.withdrawable(ev.address), evBalanceBefore + evRefund);
    await measure("withdrawStationPayment", () => registry.connect(station).withdrawPayments());
    await measure("withdrawEvRefund", () => registry.withdrawPayments());
    assert.equal(await registry.withdrawable(station.address), 0n);
    assert.equal(await registry.withdrawable(ev.address), 0n);

    const deadline = performance.now() + 90_000;
    let proposalIds;
    do {
      proposalIds = await Promise.all([evId, stationId].map((didHash) => registry.settlementScoreProposals(sessionId, didHash)));
      if (proposalIds.every((proposalId) => proposalId !== ZeroHash)) break;
      await delay(1000);
    } while (performance.now() < deadline);
    assert.ok(proposalIds.every((proposalId) => proposalId !== ZeroHash), "Oracle quorum did not finish. Check npm run besu:oracles.");
    const [evAfter, stationAfter] = await Promise.all([registry.entities(evId), registry.entities(stationId)]);
    assert.equal(evAfter.sessionsTotal, evBefore.sessionsTotal + 1n);
    assert.equal(stationAfter.sessionsTotal, stationBefore.sessionsTotal + 1n);
    const approvals = await Promise.all(proposalIds.map(async (proposalId) => {
      const events = await registry.queryFilter(registry.filters.ProposalApproved(proposalId), settled.blockNumber);
      const approvers = [...new Set(events.map((event) => event.args.approver))];
      assert.ok(approvers.length >= Number(await registry.requiredApprovals()));
      return Promise.all(events.map(async (event) => ({
        approver: event.args.approver,
        txHash: event.transactionHash,
        gasUsed: (await event.getTransactionReceipt()).gasUsed.toString()
      })));
    }));

    const batchSize = 12;
    const challenges = await Promise.all(Array.from({ length: batchSize }, async () => {
      const uniqueNonce = randomBytes(32);
      const digest = getBytes(solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "address", "uint256"],
        [evId, stationId, uniqueNonce, deployment.address, chainId]
      ));
      return [uniqueNonce, await ev.signMessage(digest), await station.signMessage(digest)];
    }));
    const sender = registry.connect(new NonceManager(ev));
    const batchStart = performance.now();
    const submissions = [];
    for (const challengeArgs of challenges) {
      submissions.push(await sender.authenticateSession(evId, stationId, ...challengeArgs, { gasLimit: 500000 }));
    }
    const receipts = await Promise.all(submissions.map((tx) => tx.wait()));
    const seconds = (performance.now() - batchStart) / 1000;
    assert.ok(receipts.every((receipt) => receipt.logs.some((log) => registry.interface.parseLog(log)?.name === "SessionAuthenticated")));
    const authorizationBatch = {
      transactions: batchSize,
      uniqueBlocks: new Set(receipts.map((receipt) => receipt.blockNumber)).size,
      confirmationSeconds: Number(seconds.toFixed(3)),
      observedTransactionsPerSecond: Number((batchSize / seconds).toFixed(2)),
      hashes: receipts.map((receipt) => receipt.hash)
    };

    const results = {
      measuredAt: new Date().toISOString(), network: "Local 4-validator Besu IBFT 2.0", chainId: Number(chainId),
      validators, sessionId, energyWh: Number(energyWh), paidWei: paid.toString(), refundedWei: evRefund.toString(),
      evScoreE4: Number(evAfter.trustScoreE4), stationScoreE4: Number(stationAfter.trustScoreE4),
      proposalIds, approvals, measurements, authorizationBatch
    };
    const reportPath = path.join(__dirname, "..", ".local-chain", "benchmark.json");
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2) + "\n");
    console.table(measurements);
    console.log(`Authorized ${batchSize} sessions in ${authorizationBatch.confirmationSeconds}s (${authorizationBatch.observedTransactionsPerSecond} tx/s in this batch).`);
    console.log(`Verified settlement, withdrawals and oracle quorum. Measurements written to ${reportPath}`);
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
