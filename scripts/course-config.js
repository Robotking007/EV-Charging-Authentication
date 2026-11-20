const fs = require("node:fs");
const path = require("node:path");

const courseChainId = 43210;
const validatorRpc = (index = 0) => `http://127.0.0.1:${8547 + index}`;
const courseDids = { ev: "did:ev:001", station: "did:station:001" };

function readCourseAccounts() {
  const file = path.join(__dirname, "..", ".local-chain", "accounts.json");
  if (!fs.existsSync(file)) throw new Error("Run npm run besu:up to create the local chain accounts.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readDeployment() {
  return require("../frontend/src/deployedAddress.json");
}

module.exports = { courseChainId, validatorRpc, courseDids, readCourseAccounts, readDeployment };
