const { artifacts, ethers, network: hardhatNetwork } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { courseChainId, courseDids, readCourseAccounts, validatorRpc } = require("./course-config");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("A deployment signing account is required.");
  console.log("Deploying EVTrustRegistry with account:", deployer.address);

  // Require 2-of-N oracle approvals before any trust-score update or slash
  // is applied, so the trust-engine oracle is not a single point of trust.
  const requiredApprovals = process.env.REQUIRED_ORACLE_APPROVALS
    ? Number(process.env.REQUIRED_ORACLE_APPROVALS)
    : 2;

  const network = await ethers.provider.getNetwork();
  const courseDeploy = process.env.EV_COURSE_DEPLOY === "1";
  if (courseDeploy && network.chainId !== BigInt(courseChainId)) throw new Error(`Expected course chain ${courseChainId}`);
  if (courseDeploy && (requiredApprovals < 2 || requiredApprovals > 3)) throw new Error("The course chain requires 2 or 3 of its 3 oracle approvals.");
  const Registry = await ethers.getContractFactory("EVTrustRegistry");
  const registry = await Registry.deploy(requiredApprovals);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const receipt = await registry.deploymentTransaction().wait();

  console.log("EVTrustRegistry deployed to:", address);
  console.log("Required oracle approvals:", requiredApprovals);
  console.log("Deployer holds DEFAULT_ADMIN_ROLE, REGISTRAR_ROLE and ORACLE_ROLE.");
  console.log("Grant ORACLE_ROLE to additional consortium oracle nodes with grantRole().");

  if (courseDeploy) {
    const accounts = readCourseAccounts();
    const role = await registry.ORACLE_ROLE();
    for (const name of ["oracle1", "oracle2", "oracle3"]) {
      await (await registry.grantRole(role, new ethers.Wallet(accounts[name]).address)).wait();
    }
    await (await registry.revokeRole(role, deployer.address)).wait();
    await (await registry.register(ethers.id(courseDids.ev), new ethers.Wallet(accounts.ev).address, false)).wait();
    await (await registry.register(ethers.id(courseDids.station), new ethers.Wallet(accounts.station).address, true)).wait();
    console.log("Registered the software EV and station and configured three separately signed oracle accounts.");
  } else if (network.chainId === 31337n && ["localhost", "hardhat"].includes(hardhatNetwork.name)) {
    const signers = await ethers.getSigners();
    const evId = ethers.id("did:ev:001");
    await (await registry.register(evId, deployer.address, false)).wait();
    for (const index of [1, 2, 3]) {
      const stationId = ethers.id(`did:station:00${index}`);
      await (await registry.register(stationId, signers[index].address, true)).wait();
    }
    await (await registry.grantRole(await registry.ORACLE_ROLE(), signers[2].address)).wait();
    console.log("Registered demo EV and three stations, and granted the demo Oracle 2 role.");
  }

  // Wires the frontend to this deployment automatically: it reads this file
  // as its default contract address so no manual copy/paste is needed.
  const deploymentInfo = {
    address,
    chainId: network.chainId.toString(),
    blockNumber: receipt.blockNumber,
    ...(courseDeploy && { rpcUrl: validatorRpc(), mode: "course" }),
    deployedAt: new Date().toISOString()
  };
  const frontendConfigPath = path.join(__dirname, "..", "frontend", "src", "deployedAddress.json");
  fs.writeFileSync(frontendConfigPath, JSON.stringify(deploymentInfo, null, 2));
  const { abi } = await artifacts.readArtifact("EVTrustRegistry");
  fs.writeFileSync(path.join(path.dirname(frontendConfigPath), "abi", "EVTrustRegistry.json"), JSON.stringify({ abi }, null, 2) + "\n");
  console.log("Wrote frontend config:", frontendConfigPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
