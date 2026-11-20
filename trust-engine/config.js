require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { HDNodeWallet, Mnemonic } = require("ethers");

// Loaded from the Hardhat artifact so the ABI always matches the deployed
// contract; run `npx hardhat compile` before starting the trust engine.
const artifactPath = path.join(
  __dirname, "..", "artifacts", "contracts", "EVTrustRegistry.sol", "EVTrustRegistry.json"
);
const { abi: registryAbi } = require(artifactPath);

// scripts/deploy.js writes this on every deploy, so the engine points at the
// current deployment without needing REGISTRY_ADDRESS set by hand.
function readDeployment() {
  const deploymentPath = path.join(__dirname, "..", "frontend", "src", "deployedAddress.json");
  if (!fs.existsSync(deploymentPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  } catch {
    return {};
  }
}

// Hardhat's local node funds accounts from this publicly documented test
// mnemonic. Used only as a LOCAL DEVELOPMENT fallback oracle key; set
// ORACLE_PRIVATE_KEY in .env for any real deployment.
function localDevOracleKey() {
  const mnemonic = Mnemonic.fromPhrase("test test test test test test test test test test test junk");
  return HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/0").privateKey;
}

const deployment = readDeployment();
const COURSE_MODE = deployment.mode === "course";
const registryAddress = process.env.REGISTRY_ADDRESS || deployment.address || "";

module.exports = {
  registryAbi,
  COURSE_MODE,
  RPC_URL: process.env.BESU_RPC_URL || deployment.rpcUrl || "http://127.0.0.1:8545",
  ORACLE_PRIVATE_KEY: COURSE_MODE ? null : process.env.ORACLE_PRIVATE_KEY || localDevOracleKey(),
  REGISTRY_ADDRESS: registryAddress,
  DEPLOYMENT_BLOCK: Number(process.env.REGISTRY_DEPLOYMENT_BLOCK ??
    (registryAddress === deployment.address ? deployment.blockNumber : 0) ?? 0),
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
  MONGODB_DB: process.env.MONGODB_DB || "ev_charging",
  PORT: process.env.PORT || 3001,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
};
