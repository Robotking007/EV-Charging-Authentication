const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Wallet, parseEther } = require("ethers");
const { courseChainId } = require("./course-config");

const ROOT = path.join(__dirname, "..");
const state = path.join(ROOT, ".local-chain");
const command = process.argv[2];

if (command !== "up" && command !== "down") {
  throw new Error("Usage: node scripts/besu-network.js up|down");
}

if (command === "up") {
  fs.mkdirSync(state, { recursive: true });
  const accountFile = path.join(state, "accounts.json");
  if (!fs.existsSync(accountFile)) {
    const accounts = Object.fromEntries(
      ["admin", "oracle1", "oracle2", "oracle3", "ev", "station"].map((name) => [name, Wallet.createRandom().privateKey])
    );
    fs.writeFileSync(accountFile, JSON.stringify(accounts, null, 2), { mode: 0o600, flag: "wx" });
  }
  const accounts = JSON.parse(fs.readFileSync(accountFile, "utf8"));
  const config = {
    genesis: {
      config: {
        chainId: courseChainId,
        berlinBlock: 0,
        londonBlock: 0,
        shanghaiTime: 0,
        cancunTime: 0,
        ibft2: { blockperiodseconds: 1, epochlength: 30000, requesttimeoutseconds: 4 }
      },
      nonce: "0x0",
      timestamp: "0x0",
      gasLimit: "0x1c9c380",
      difficulty: "0x1",
      mixHash: "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
      coinbase: "0x0000000000000000000000000000000000000000",
      alloc: Object.fromEntries(Object.values(accounts).map((key) => [
        new Wallet(key).address.slice(2), { balance: "0x" + parseEther("1000").toString(16) }
      ]))
    },
    blockchain: { nodes: { generate: true, count: 4 } }
  };
  const configFile = path.join(state, "ibft-config.json");
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

const script = "scripts/besu-network.sh";
const isWindows = process.platform === "win32";
const result = spawnSync(isWindows ? "wsl.exe" : "bash",
  isWindows ? ["--", "bash", script, command] : [script, command],
  { cwd: ROOT, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
