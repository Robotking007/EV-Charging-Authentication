const fs = require("fs");
const path = require("path");

/**
 * File-backed reputation store for the reference implementation.
 *
 * Swap this out for a real Postgres-backed store in production; the
 * important contract to preserve is withLock(didHash, fn): every read and
 * write of an entity's (alpha, beta, lastUpdated) must happen inside the
 * same lock so concurrent session-closed events for the same entity cannot
 * clobber each other (a Postgres port should use `SELECT ... FOR UPDATE`
 * inside a transaction to get the same guarantee).
 */
class ReputationStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, "reputation-store.json");
    this._locks = new Map(); // didHash => Promise chain, serializes access per entity
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({}), "utf8");
    }
  }

  _readAll() {
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  _writeAll(data) {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  /**
   * Runs `fn(current)` with exclusive access to `didHash`'s reputation
   * record. `current` is `null` if the entity has no prior record. `fn`
   * must return the new record to persist (or `null` to leave unchanged).
   */
  async withLock(didHash, fn) {
    const previous = this._locks.get(didHash) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => next);
    this._locks.set(didHash, tail);

    await previous;
    try {
      const current = this._readAll()[didHash] || null;
      const updated = await fn(current);
      if (updated) {
        const all = this._readAll();
        all[didHash] = updated;
        this._writeAll(all);
      }
      return updated || current;
    } finally {
      release();
      if (this._locks.get(didHash) === tail) this._locks.delete(didHash);
    }
  }
}

module.exports = { ReputationStore };
