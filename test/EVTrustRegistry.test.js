const { expect } = require("chai");
const { ethers } = require("hardhat");

async function signSession(signer, evId, stationId, nonce, contractAddress, chainId) {
  const digest = ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32", "bytes32", "address", "uint256"],
    [evId, stationId, nonce, contractAddress, chainId]
  );
  return signer.signMessage(ethers.getBytes(digest));
}

describe("EVTrustRegistry", function () {
  let registry, admin, oracle1, oracle2, oracle3, evSigner, stationSigner;
  const evId = ethers.keccak256(ethers.toUtf8Bytes("did:ev:001"));
  const stationId = ethers.keccak256(ethers.toUtf8Bytes("did:station:001"));

  beforeEach(async function () {
    [admin, oracle1, oracle2, oracle3, evSigner, stationSigner] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("EVTrustRegistry");
    registry = await Registry.deploy(2); // require 2-of-N oracle approvals
    await registry.waitForDeployment();

    const ORACLE_ROLE = await registry.ORACLE_ROLE();
    await registry.grantRole(ORACLE_ROLE, oracle1.address);
    await registry.grantRole(ORACLE_ROLE, oracle2.address);
    await registry.grantRole(ORACLE_ROLE, oracle3.address);

    await registry.register(evId, evSigner.address, false);
    await registry.register(stationId, stationSigner.address, true);
  });

  async function authorize(evKey = evSigner, stationKey = stationSigner) {
    const nonce = ethers.randomBytes(32);
    const { chainId } = await ethers.provider.getNetwork();
    const address = await registry.getAddress();
    const evSig = await signSession(evKey, evId, stationId, nonce, address, chainId);
    const stationSig = await signSession(stationKey, evId, stationId, nonce, address, chainId);
    return registry.authenticateSession(evId, stationId, nonce, evSig, stationSig);
  }

  async function fund(maxWh, pricePerWh, expiresIn = 120) {
    const receipt = await (await authorize()).wait();
    const event = receipt.logs.map((log) => registry.interface.parseLog(log)).find((log) => log?.name === "SessionAuthenticated");
    const { sessionId } = event.args;
    const expiresAt = (await ethers.provider.getBlock("latest")).timestamp + expiresIn;
    await registry.connect(evSigner).fundSession(sessionId, maxWh, pricePerWh, expiresAt, { value: maxWh * pricePerWh });
    return { sessionId, maxWh, pricePerWh, expiresAt };
  }

  async function signMeter(session, energyWh) {
    const { chainId } = await ethers.provider.getNetwork();
    const digest = ethers.getBytes(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint64", "uint64", "uint256", "uint64", "address", "uint256"],
      [session.sessionId, energyWh, session.maxWh, session.pricePerWh, session.expiresAt, await registry.getAddress(), chainId]
    )));
    return Promise.all([evSigner.signMessage(digest), stationSigner.signMessage(digest)]);
  }

  it("registers entities with a neutral 0.5 prior trust score", async function () {
    const ev = await registry.entities(evId);
    expect(ev.trustScoreE4).to.equal(5000n);
    expect(ev.registered).to.equal(true);
  });

  it("denies session authorization when a party is below the trust threshold", async function () {
    // Neutral prior (5000) is above the default 3000 threshold, so first drop it.
    let proposalId = await registry.proposeScoreUpdate.staticCall(evId, 1000, false);
    await registry.connect(oracle1).proposeScoreUpdate(evId, 1000, false);
    await registry.connect(oracle2).approveProposal(proposalId);

    const ev = await registry.entities(evId);
    expect(ev.trustScoreE4).to.equal(1000n);

    const nonce = ethers.randomBytes(32);
    const network = await ethers.provider.getNetwork();
    const registryAddress = await registry.getAddress();
    const evSig = await signSession(evSigner, evId, stationId, nonce, registryAddress, network.chainId);
    const stationSig = await signSession(stationSigner, evId, stationId, nonce, registryAddress, network.chainId);

    const tx = await registry.authenticateSession(evId, stationId, nonce, evSig, stationSig);
    await expect(tx).to.emit(registry, "SessionDenied");
    await expect(tx).to.not.emit(registry, "SessionAuthenticated");
  });

  it("authorizes a session when both parties are above the trust threshold", async function () {
    const nonce = ethers.randomBytes(32);
    const network = await ethers.provider.getNetwork();
    const registryAddress = await registry.getAddress();
    const evSig = await signSession(evSigner, evId, stationId, nonce, registryAddress, network.chainId);
    const stationSig = await signSession(stationSigner, evId, stationId, nonce, registryAddress, network.chainId);

    const tx = await registry.authenticateSession(evId, stationId, nonce, evSig, stationSig);
    await expect(tx).to.emit(registry, "SessionAuthenticated");
  });

  it("rejects a replayed nonce", async function () {
    const nonce = ethers.randomBytes(32);
    const network = await ethers.provider.getNetwork();
    const registryAddress = await registry.getAddress();
    const evSig = await signSession(evSigner, evId, stationId, nonce, registryAddress, network.chainId);
    const stationSig = await signSession(stationSigner, evId, stationId, nonce, registryAddress, network.chainId);

    await registry.authenticateSession(evId, stationId, nonce, evSig, stationSig);
    await expect(
      registry.authenticateSession(evId, stationId, nonce, evSig, stationSig)
    ).to.be.revertedWith("nonce reused");
  });

  it("rejects a forged signature", async function () {
    const nonce = ethers.randomBytes(32);
    const network = await ethers.provider.getNetwork();
    const registryAddress = await registry.getAddress();
    // stationSigner signs on behalf of the EV: signature won't match ev.pubKey
    const forgedEvSig = await signSession(stationSigner, evId, stationId, nonce, registryAddress, network.chainId);
    const stationSig = await signSession(stationSigner, evId, stationId, nonce, registryAddress, network.chainId);

    await expect(
      registry.authenticateSession(evId, stationId, nonce, forgedEvSig, stationSig)
    ).to.be.revertedWith("ev sig invalid");
  });

  it("requires M-of-N oracle approvals before a score update takes effect", async function () {
    const proposalId = await registry.proposeScoreUpdate.staticCall(evId, 8000, true);
    await registry.connect(oracle1).proposeScoreUpdate(evId, 8000, true);

    let ev = await registry.entities(evId);
    expect(ev.trustScoreE4).to.equal(5000n); // unchanged: only 1 of 2 required approvals

    await registry.connect(oracle2).approveProposal(proposalId);
    ev = await registry.entities(evId);
    expect(ev.trustScoreE4).to.equal(8000n);
  });

  it("rejects a proposed score above the 0-10000 bound", async function () {
    await expect(
      registry.connect(oracle1).proposeScoreUpdate(evId, 10001, true)
    ).to.be.revertedWith("score out of range");
  });

  it("approves proposals for the zero DID if it is already registered", async function () {
    const did = ethers.ZeroHash;
    await registry.register(did, evSigner.address, false);
    const proposalId = await registry.connect(oracle1).proposeScoreUpdate.staticCall(did, 7500, true);
    await registry.connect(oracle1).proposeScoreUpdate(did, 7500, true);
    await registry.connect(oracle2).approveProposal(proposalId);
    expect((await registry.entities(did)).trustScoreE4).to.equal(7500n);
  });

  it("counts sessions approved out of order and preserves the newest proposed score", async function () {
    const first = await registry.connect(oracle1).proposeScoreUpdate.staticCall(evId, 3500, false);
    await registry.connect(oracle1).proposeScoreUpdate(evId, 3500, false);
    const second = await registry.connect(oracle1).proposeScoreUpdate.staticCall(evId, 5000, true);
    await registry.connect(oracle1).proposeScoreUpdate(evId, 5000, true);

    await registry.connect(oracle2).approveProposal(second);
    await registry.connect(oracle2).approveProposal(first);

    const ev = await registry.entities(evId);
    expect(ev.trustScoreE4).to.equal(5000n);
    expect(ev.sessionsTotal).to.equal(2n);
    expect(ev.sessionsFailed).to.equal(1n);
  });

  it("applies a slash as a direct penalty independent of the decayed average", async function () {
    const proposalId = await registry.proposeSlash.staticCall(stationId, 4000);
    await registry.connect(oracle1).proposeSlash(stationId, 4000);
    await registry.connect(oracle2).approveProposal(proposalId);

    const station = await registry.entities(stationId);
    expect(station.trustScoreE4).to.equal(1000n); // 5000 - 4000
  });

  it("clamps a slash penalty larger than the current score to zero", async function () {
    const proposalId = await registry.proposeSlash.staticCall(stationId, 9000);
    await registry.connect(oracle1).proposeSlash(stationId, 9000);
    await registry.connect(oracle2).approveProposal(proposalId);

    const station = await registry.entities(stationId);
    expect(station.trustScoreE4).to.equal(0n);
  });

  it("does not allow a non-admin to change the trust threshold", async function () {
    await expect(
      registry.connect(oracle1).setMinTrustScore(9000)
    ).to.be.reverted;
  });

  it("pays the station and refunds the unused budget only for a jointly signed meter total", async function () {
    const session = await fund(1000n, 50n);
    const [evSig, stationSig] = await signMeter(session, 380n);
    await expect(registry.settleSession(session.sessionId, 381n, evSig, stationSig)).to.be.revertedWith("invalid EV meter signature");
    await expect(registry.settleSession(session.sessionId, 1001n, evSig, stationSig)).to.be.revertedWith("energy exceeds budget");
    await expect(registry.settleSession(session.sessionId, 380n, evSig, stationSig))
      .to.emit(registry, "SessionSettled").withArgs(session.sessionId, evId, stationId, 380n, 19000n);
    await expect(registry.settleSession(session.sessionId, 380n, evSig, stationSig)).to.be.revertedWith("session not settleable");
    expect(await registry.withdrawable(evSigner.address)).to.equal(31000n);
    await expect(registry.connect(stationSigner).withdrawPayments()).to.changeEtherBalance(stationSigner, 19000n);
    expect(await registry.withdrawable(stationSigner.address)).to.equal(0n);
  });

  it("returns an expired unsigned budget to the EV", async function () {
    const session = await fund(1000n, 50n, 10);
    await expect(registry.refundExpiredSession(session.sessionId)).to.be.revertedWith("session not refundable");
    await ethers.provider.send("evm_setNextBlockTimestamp", [session.expiresAt]);
    await expect(registry.refundExpiredSession(session.sessionId)).to.emit(registry, "SessionRefunded");
    expect(await registry.withdrawable(evSigner.address)).to.equal(50000n);
    expect(await registry.withdrawable(stationSigner.address)).to.equal(0n);
  });

  it("lets independent oracles choose a correct candidate and counts a settlement once", async function () {
    const session = await fund(1000n, 50n);
    await expect(registry.connect(oracle1).proposeSettlementScore(session.sessionId, evId, 6600))
      .to.be.revertedWith("session not settled");
    const [evSig, stationSig] = await signMeter(session, 380n);
    await registry.settleSession(session.sessionId, 380n, evSig, stationSig);
    await registry.connect(oracle1).proposeSettlementScore(session.sessionId, evId, 5000);
    await registry.connect(oracle2).proposeSettlementScore(session.sessionId, evId, 6667);
    const expected = await registry.settlementScoreCandidates(session.sessionId, evId, 6667);
    const alternate = await registry.settlementScoreCandidates(session.sessionId, evId, 5000);
    await registry.connect(oracle3).approveProposal(expected);
    await registry.connect(oracle3).approveProposal(alternate);
    expect(await registry.settlementScoreProposals(session.sessionId, evId)).to.equal(expected);
    const ev = await registry.entities(evId);
    expect(ev.sessionsTotal).to.equal(1n);
    expect(ev.trustScoreE4).to.equal(6667n);
  });

  it("requires registrar approval for key rotation and prevents revoked identities from authenticating", async function () {
    await expect(registry.connect(oracle1).rotateIdentityKey(evId, oracle2.address)).to.be.reverted;
    await registry.rotateIdentityKey(evId, oracle2.address);
    await expect(authorize()).to.be.revertedWith("ev sig invalid");
    await expect(authorize(oracle2)).to.emit(registry, "SessionAuthenticated");
    await registry.revokeIdentity(evId);
    await expect(authorize(oracle2)).to.be.revertedWith("bad ev");
  });
});
