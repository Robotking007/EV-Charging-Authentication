const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { updateBeta, timeDecayFactor } = require("./trustEngine");
const { ReputationStore } = require("./reputationStore");

test("first success updates the neutral prior to 2/3", () => {
  const now = Date.now();
  const { trustScore } = updateBeta(1, 1, now, now, true);
  // one success added on top of an undecayed Beta(1,1) prior -> 2/3
  assert.ok(Math.abs(trustScore - 2 / 3) < 1e-9);
});

test("score decays toward the neutral prior over elapsed time, not just per session", () => {
  const t0 = Date.now();
  const oneWeekLaterMs = t0 + 7 * 24 * 60 * 60 * 1000;

  // Same (alpha, beta) but a long idle gap should decay much further than
  // a fresh update at the same timestamp.
  const fresh = updateBeta(9, 1, t0, t0, true);
  const decayed = updateBeta(9, 1, t0, oneWeekLaterMs, true);
  const longIdle = updateBeta(9, 1, t0, t0 + 365 * 24 * 60 * 60 * 1000, true);

  assert.ok(decayed.alpha < fresh.alpha, "idle alpha should have decayed below the fresh update");
  assert.ok(timeDecayFactor(t0, oneWeekLaterMs) < timeDecayFactor(t0, t0 + 1));
  assert.ok(Math.abs(longIdle.trustScore - 2 / 3) < 1e-9, "only evidence above the prior should decay");
});

test("ReputationStore preserves updates to different entities completed out of order", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reputation-test-"));
  const file = path.join(dir, "store.json");
  const store = new ReputationStore(file);
  t.after(() => {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  });

  let finishFirst;
  const first = store.withLock("ev", async () => {
    await new Promise((resolve) => { finishFirst = resolve; });
    return { count: 1 };
  });
  await store.withLock("station", async () => ({ count: 2 }));
  finishFirst();
  await first;

  assert.deepEqual(await store.withLock("ev", () => null), { count: 1 });
  assert.deepEqual(await store.withLock("station", () => null), { count: 2 });
});

test("failed session pulls the score down", () => {
  const now = Date.now();
  const { trustScore } = updateBeta(1, 1, now, now, false);
  assert.ok(trustScore < 0.5);
});

test("ReputationStore serializes concurrent updates for the same entity", async () => {
  const tmpFile = path.join(os.tmpdir(), `reputation-test-${Date.now()}.json`);
  const store = new ReputationStore(tmpFile);

  const didHash = "0xabc";
  const writes = Array.from({ length: 20 }, (_, i) =>
    store.withLock(didHash, async (prev) => {
      const count = prev ? prev.count + 1 : 1;
      return { count };
    })
  );

  await Promise.all(writes);
  const finalState = await store.withLock(didHash, async (prev) => prev);
  assert.equal(finalState.count, 20, "every concurrent increment must be preserved, none lost to a race");

  fs.unlinkSync(tmpFile);
});
