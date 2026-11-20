const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const script = "scripts/mongo-local.sh";
const windows = process.platform === "win32";
const result = spawnSync(windows ? "wsl.exe" : "bash", windows ? ["--", "bash", script] : [script], {
  cwd: root, stdio: "inherit"
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
