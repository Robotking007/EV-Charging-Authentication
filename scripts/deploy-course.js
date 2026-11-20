const { spawnSync } = require("node:child_process");
const path = require("node:path");

const result = spawnSync(process.execPath, [
  require.resolve("hardhat/internal/cli/bootstrap"),
  "run", "scripts/deploy.js", "--network", "besu"
], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, EV_COURSE_DEPLOY: "1" },
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
