const { spawn } = require("node:child_process");
const path = require("node:path");
const { readDeployment } = require("./course-config");

if (readDeployment().mode !== "course") throw new Error("Run npm run besu:deploy first.");
const worker = path.join(__dirname, "..", "trust-engine", "oracleWorker.js");
const children = [1, 2, 3].map((index) => spawn(process.execPath, [worker, String(index)], { stdio: "inherit" }));
let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (stopping) return;
    process.exitCode = code || 1;
    stop();
  });
}
