const { ReputationStore } = require("./reputationStore");

// Beta-distribution reputation with EXPONENTIAL TIME DECAY (not per-session
// count decay): an idle entity's score keeps decaying toward the neutral
// prior as calendar time passes, not only when a new session closes.
const DECAY_RATE_PER_HOUR = 0.01; // ~50% decay every ~69 hours (ln(2)/0.01)
const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;

function timeDecayFactor(prevLastUpdatedMs, nowMs) {
  const elapsedHours = Math.max(0, (nowMs - prevLastUpdatedMs) / (1000 * 60 * 60));
  return Math.exp(-DECAY_RATE_PER_HOUR * elapsedHours);
}

/**
 * Applies time decay to (alpha, beta) for the elapsed period since
 * lastUpdatedMs, then folds in the new session outcome.
 */
function updateBeta(prevAlpha, prevBeta, prevLastUpdatedMs, nowMs, sessionSucceeded) {
  const decay = timeDecayFactor(prevLastUpdatedMs, nowMs);
  const alpha = PRIOR_ALPHA + (prevAlpha - PRIOR_ALPHA) * decay + (sessionSucceeded ? 1 : 0);
  const beta = PRIOR_BETA + (prevBeta - PRIOR_BETA) * decay + (sessionSucceeded ? 0 : 1);
  const trustScore = alpha / (alpha + beta); // expected value of Beta(alpha, beta)
  return { alpha, beta, trustScore };
}

class TrustEngine {
  /**
   * @param {ethers.Contract} registry EVTrustRegistry contract connected to
   *   an oracle wallet (must hold ORACLE_ROLE).
   * @param {ReputationStore} store
   */
  constructor(registry, store) {
    this.registry = registry;
    this.store = store || new ReputationStore();
  }

  /**
   * Called by the session-settlement webhook once a charging session
   * closes. Read-modify-write of the entity's reputation is serialized
   * through ReputationStore#withLock so two sessions closing concurrently
   * for the same entity cannot silently overwrite each other's update.
   */
  async onSessionClosed(didHash, sessionSucceeded, sessionId) {
    didHash = didHash.toLowerCase();
    let result;
    await this.store.withLock(didHash, async (prev) => {
      const previousSettlement = sessionId && prev?.settlements?.[sessionId];
      if (previousSettlement) {
        if (previousSettlement.sessionSucceeded !== sessionSucceeded) {
          throw Object.assign(new Error("This session already has a different outcome"), { status: 409 });
        }
        result = previousSettlement;
        return null;
      }

      const nowMs = Date.now();
      const prevAlpha = prev ? prev.alpha : PRIOR_ALPHA;
      const prevBeta = prev ? prev.beta : PRIOR_BETA;
      const prevLastUpdatedMs = prev ? prev.lastUpdatedMs : nowMs;

      const { alpha, beta, trustScore } = updateBeta(
        prevAlpha, prevBeta, prevLastUpdatedMs, nowMs, sessionSucceeded
      );

      const scoreE4 = Math.round(trustScore * 10000);
      const tx = await this.registry.proposeScoreUpdate(didHash, scoreE4, sessionSucceeded);
      const { proposalId, txHash } = await this.readProposalReceipt(tx);
      result = { scoreE4, proposalId, txHash, sessionSucceeded };

      const updated = { ...prev, alpha, beta, trustScore, lastUpdatedMs: nowMs };
      if (sessionId) updated.settlements = { ...prev?.settlements, [sessionId]: result };
      return updated;
    });

    const [proposal, requiredApprovals] = await Promise.all([
      this.registry.proposals(result.proposalId),
      this.registry.requiredApprovals()
    ]);
    return { ...result, executed: proposal.executed, approvals: Number(proposal.approvalCount), requiredApprovals: Number(requiredApprovals) };
  }

  /**
   * Proposes a direct penalty for provable misbehavior (e.g. a double-signed
   * session, or an implausible energy reading caught by an oracle
   * cross-check), independent of the decayed reputation average.
   */
  async onMisbehaviorProven(didHash, penaltyE4) {
    const tx = await this.registry.proposeSlash(didHash, penaltyE4);
    const { proposalId, txHash } = await this.readProposalReceipt(tx);
    const proposal = await this.registry.proposals(proposalId);
    return { txHash, proposalId, executed: proposal.executed, approvals: Number(proposal.approvalCount) };
  }

  async readProposalReceipt(tx) {
    const receipt = await tx.wait();
    const registryAddress = (await this.registry.getAddress()).toLowerCase();
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddress) continue;
      const event = this.registry.interface.parseLog(log);
      if (event?.name === "ProposalCreated") {
        return { proposalId: event.args.proposalId, txHash: receipt.hash };
      }
    }
    throw new Error("Registry transaction did not emit ProposalCreated");
  }
}

module.exports = { TrustEngine, updateBeta, timeDecayFactor };
