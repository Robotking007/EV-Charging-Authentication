const BATCH_SIZE = 1000;

function namedArgs(event) {
  return Object.fromEntries(event.fragment.inputs.map(({ name }, i) => {
    const value = event.args[i];
    return [name || String(i), typeof value === "bigint" ? value.toString() : value];
  }));
}

class LedgerRecords {
  constructor(db, registry, deploymentBlock) {
    this.registry = registry;
    this.provider = registry.runner.provider ?? registry.runner;
    this.deploymentBlock = deploymentBlock;
    this.events = db.collection("ledger_events");
    this.sessions = db.collection("charging_sessions");
    this.entities = db.collection("registry_entities");
    this.proposals = db.collection("oracle_proposals");
    this.checkpoints = db.collection("ledger_checkpoints");
  }

  async initialize() {
    const address = (await this.registry.getAddress()).toLowerCase();
    const [network, deployment] = await Promise.all([
      this.provider.getNetwork(), this.provider.getBlock(this.deploymentBlock)
    ]);
    if (!deployment) throw new Error("The registry deployment block is unavailable.");
    await Promise.all([
      this.events.createIndex({ scope: 1, blockNumber: -1, logIndex: -1 }),
      this.sessions.createIndex({ scope: 1, evId: 1, blockNumber: -1 }),
      this.sessions.createIndex({ scope: 1, stationId: 1, blockNumber: -1 }),
      this.entities.createIndex({ scope: 1, blockNumber: -1 }),
      this.proposals.createIndex({ scope: 1, blockNumber: -1 })
    ]);
    this.scope = `${network.chainId}:${address}:${deployment.hash}`;
  }

  async sync() {
    if (!this.scope) await this.initialize();
    const checkpoint = await this.checkpoints.findOne({ _id: this.scope });
    let start = (checkpoint?.blockNumber ?? this.deploymentBlock - 1) + 1;
    const head = await this.provider.getBlockNumber();
    while (start <= head) {
      const end = Math.min(head, start + BATCH_SIZE - 1);
      const logs = await this.registry.queryFilter("*", start, end);
      const entries = logs.filter((log) => log.fragment).map((log) => ({
        _id: `${this.scope}:${log.transactionHash}:${log.index}`,
        scope: this.scope,
        name: log.eventName,
        args: namedArgs(log),
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index
      })).sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
      if (entries.length) {
        await this.events.bulkWrite(entries.map((entry) => ({
          replaceOne: { filter: { _id: entry._id }, replacement: entry, upsert: true }
        })));
        await Promise.all([
          this.updateSessions(entries),
          this.snapshot(this.entities, entries, "didHash", "entities", end, ["Registered", "IdentityKeyChanged", "IdentityRevoked", "TrustScoreUpdated", "Slashed", "ProposalApproved"]),
          this.snapshot(this.proposals, entries, "proposalId", "proposals", end, ["ProposalCreated", "ProposalApproved"])
        ]);
      }
      await this.checkpoints.updateOne({ _id: this.scope }, { $set: { blockNumber: end } }, { upsert: true });
      start = end + 1;
    }
  }

  async snapshot(collection, entries, field, method, blockTag, names) {
    const changed = new Set();
    for (const entry of entries) {
      if (!names.includes(entry.name)) continue;
      if (entry.args[field]) changed.add(entry.args[field]);
      // An approved proposal can update session counters without changing the score.
      if (field === "didHash" && entry.name === "ProposalApproved") {
        const proposal = await this.registry.proposals(entry.args.proposalId);
        if (proposal.executed) changed.add(proposal.didHash);
      }
    }
    const operations = [];
    for (const key of changed) {
      const record = (await this.registry[method](key)).toObject();
      const values = Object.fromEntries(Object.entries(record).map(([name, value]) => [name, typeof value === "bigint" ? value.toString() : value]));
      if (method === "entities") values.revoked = await this.registry.revoked(key).catch((error) => {
        if (error.code === "CALL_EXCEPTION" && error.data === "0x") return false;
        throw error;
      });
      const _id = `${this.scope}:${key}`;
      operations.push({
        replaceOne: { filter: { _id }, replacement: { _id, scope: this.scope, [field]: key, ...values, blockNumber: blockTag }, upsert: true }
      });
    }
    if (operations.length) await collection.bulkWrite(operations);
  }

  async updateSessions(entries) {
    const status = {
      SessionAuthenticated: "authorized",
      SessionDenied: "denied",
      SessionFunded: "funded",
      SessionSettled: "settled",
      SessionRefunded: "refunded"
    };
    const updates = entries.filter((entry) => status[entry.name]).map((entry) => ({
      updateOne: {
        filter: { _id: `${this.scope}:${entry.args.sessionId}` },
        update: {
          $set: {
            scope: this.scope,
            ...entry.args,
            status: status[entry.name],
            blockNumber: entry.blockNumber,
            transactionHash: entry.transactionHash
          }
        },
        upsert: true
      }
    }));
    if (updates.length) await this.sessions.bulkWrite(updates);
  }

  async read(collection, filter, limit) {
    const checkpoint = this.scope && await this.checkpoints.findOne({ _id: this.scope });
    if (!checkpoint) return null;
    const rows = await collection.find({ ...filter, scope: this.scope, blockNumber: { $lte: checkpoint.blockNumber } })
      .project({ _id: 0, scope: 0 }).sort({ blockNumber: -1, logIndex: -1 }).limit(limit).toArray();
    return { indexedThrough: checkpoint.blockNumber, records: rows };
  }
}

module.exports = { LedgerRecords };
