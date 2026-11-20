const { setTimeout: delay } = require("node:timers/promises");
const { Contract, JsonRpcProvider, Wallet, ZeroHash } = require("ethers");
const { updateBeta } = require("./trustEngine");
const { courseChainId, readCourseAccounts, readDeployment, validatorRpc } = require("../scripts/course-config");
const { abi } = require("../artifacts/contracts/EVTrustRegistry.sol/EVTrustRegistry.json");

async function reconcileScore(registry, oracle, sessionId, didHash, score) {
  const [applied, candidate] = await Promise.all([
    registry.settlementScoreProposals(sessionId, didHash),
    registry.settlementScoreCandidates(sessionId, didHash, score)
  ]);
  if (applied !== ZeroHash) {
    if (applied !== candidate) throw new Error(`Unexpected quorum result for session ${sessionId}, DID ${didHash}`);
    return;
  }
  try {
    if (candidate === ZeroHash) {
      await (await registry.proposeSettlementScore(sessionId, didHash, score)).wait();
    } else if (!await registry.hasApproved(candidate, oracle)) {
      await (await registry.approveProposal(candidate)).wait();
    }
  } catch (error) {
    const current = await registry.settlementScoreCandidates(sessionId, didHash, score);
    if (current === ZeroHash) throw error;
    const nowApplied = await registry.settlementScoreProposals(sessionId, didHash);
    if (nowApplied === current) return;
    if (nowApplied !== ZeroHash) throw error;
    if (!await registry.hasApproved(current, oracle)) {
      await (await registry.approveProposal(current)).wait();
    }
  }
}

async function runOracle(index) {
  if (![1, 2, 3].includes(index)) throw new Error("Select oracle 1, 2, or 3.");
  const deployment = readDeployment();
  if (deployment.mode !== "course") throw new Error("Deploy the course registry with npm run besu:deploy.");
  const provider = new JsonRpcProvider(validatorRpc(index), undefined, { cacheTimeout: -1 });
  const oracle = new Wallet(readCourseAccounts()[`oracle${index}`], provider);
  const registry = new Contract(deployment.address, abi, oracle);
  const reputation = new Map();
  let fromBlock = deployment.blockNumber;
  let lastProcessed;
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  try {
    if ((await provider.getNetwork()).chainId !== BigInt(courseChainId)) throw new Error("Connected to the wrong chain.");
    if (!await registry.hasRole(await registry.ORACLE_ROLE(), oracle.address)) throw new Error("Oracle role is missing.");
    console.log(`Oracle ${index} connected to validator RPC ${validatorRpc(index)} as ${oracle.address}`);
    while (!stopping) {
      try {
        const head = await provider.getBlockNumber();
        if (head >= fromBlock) {
          const toBlock = Math.min(head, fromBlock + 499);
          const settlements = await registry.queryFilter(registry.filters.SessionSettled(), fromBlock, toBlock);
          for (const event of settlements) {
            if (lastProcessed?.blockNumber === event.blockNumber && lastProcessed.index >= event.index) continue;
            const { sessionId, evId, stationId, energyWh } = event.args;
            const now = (await event.getBlock()).timestamp * 1000;
            const updates = [];
            for (const didHash of [evId, stationId]) {
              const previous = reputation.get(didHash);
              const result = updateBeta(previous?.alpha ?? 1, previous?.beta ?? 1, previous?.time ?? now, now, energyWh > 0n);
              const score = Math.round(result.trustScore * 10000);
              await reconcileScore(registry, oracle.address, sessionId, didHash, score);
              updates.push([didHash, { ...result, time: now }]);
            }
            for (const [didHash, update] of updates) reputation.set(didHash, update);
            fromBlock = event.blockNumber;
            lastProcessed = event;
            console.log(`Oracle ${index} verified ${sessionId} (${energyWh} Wh)`);
          }
          fromBlock = toBlock + 1;
        }
      } catch (error) {
        console.error(`Oracle ${index} will retry: ${error.shortMessage || error.message}`);
      }
      if (!stopping) await delay(1000);
    }
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  runOracle(Number(process.argv[2])).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
