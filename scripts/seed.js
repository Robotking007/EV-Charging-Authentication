const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer, account1, account2] = await ethers.getSigners();
  const deploymentPath = path.join(__dirname, "..", "frontend", "src", "deployedAddress.json");
  const { address } = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const registry = await ethers.getContractAt("EVTrustRegistry", address);

  const targetAccount = process.env.TARGET_ACCOUNT || "0x9c253d2d9447de2286d4aa686790905b29fd7eff";

  console.log(`Funding ${targetAccount} with 50 ETH...`);
  const tx1 = await deployer.sendTransaction({
    to: targetAccount,
    value: ethers.parseEther("50.0")
  });
  await tx1.wait();

  const ORACLE_ROLE = await registry.ORACLE_ROLE();
  const REGISTRAR_ROLE = await registry.REGISTRAR_ROLE();
  const DEFAULT_ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();

  console.log(`Granting roles to ${targetAccount}...`);
  await (await registry.grantRole(DEFAULT_ADMIN_ROLE, targetAccount)).wait();
  await (await registry.grantRole(REGISTRAR_ROLE, targetAccount)).wait();
  await (await registry.grantRole(ORACLE_ROLE, targetAccount)).wait();

  // Grant ORACLE_ROLE to account1 and account2 for quorum testing
  await (await registry.grantRole(ORACLE_ROLE, account1.address)).wait();
  await (await registry.grantRole(ORACLE_ROLE, account2.address)).wait();

  // Register demo entities if not already registered
  const evId = ethers.keccak256(ethers.toUtf8Bytes("did:ev:001"));
  const stationId = ethers.keccak256(ethers.toUtf8Bytes("did:station:001"));

  const evEntity = await registry.entities(evId);
  if (!evEntity.registered) {
    console.log("Registering demo EV: did:ev:001 with signing address", deployer.address);
    await (await registry.register(evId, deployer.address, false)).wait();
  }

  const stationEntity = await registry.entities(stationId);
  if (!stationEntity.registered) {
    console.log("Registering demo Station: did:station:001 with signing address", account1.address);
    await (await registry.register(stationId, account1.address, true)).wait();
  }

  console.log("Seeding complete!");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
