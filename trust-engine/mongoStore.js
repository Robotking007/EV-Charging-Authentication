const fs = require("node:fs/promises");
const path = require("node:path");
const { MongoClient } = require("mongodb");
const { MONGODB_URI, MONGODB_DB } = require("./config");

async function connectMongo() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    const db = client.db(MONGODB_DB);
    await db.command({ ping: 1 });
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}

class MongoReputationStore {
  constructor(db) {
    this.records = db.collection("reputation");
    this.pending = new Map();
  }

  async importLegacy(file = path.join(__dirname, "reputation-store.json")) {
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
    const rows = Object.entries(JSON.parse(raw));
    if (!rows.length) return 0;
    const result = await this.records.bulkWrite(rows.map(([key, value]) => ({
      updateOne: {
        filter: { _id: key.toLowerCase() },
        update: { $setOnInsert: { value } },
        upsert: true
      }
    })));
    return result.upsertedCount;
  }

  // The local trust API owns all writes and serializes updates for each key.
  async withLock(key, update) {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const { value: current = null } = await this.records.findOne({ _id: key }) ?? {};
      const next = await update(current);
      if (next) await this.records.updateOne({ _id: key }, { $set: { value: next } }, { upsert: true });
      return next ?? current;
    });
    const tail = operation.catch(() => {});
    this.pending.set(key, tail);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === tail) this.pending.delete(key);
    }
  }
}

module.exports = { connectMongo, MongoReputationStore };
