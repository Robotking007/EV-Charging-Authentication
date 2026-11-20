import { AbiCoder, keccak256, solidityPackedKeccak256, getBytes } from "ethers";

/**
 * Reproduces EVTrustRegistry.authenticateSession's expected digest:
 * keccak256(evId, stationId, nonce, address(this), chainId), then signed
 * as a standard Ethereum signed message (wallet.signMessage does the
 * "\x19Ethereum Signed Message:\n32" prefixing to match
 * MessageHashUtils.toEthSignedMessageHash on-chain).
 */
export function buildSessionDigest(evId, stationId, nonce, contractAddress, chainId) {
  return solidityPackedKeccak256(
    ["bytes32", "bytes32", "bytes32", "address", "uint256"],
    [evId, stationId, nonce, contractAddress, chainId]
  );
}

export async function signSession(wallet, evId, stationId, nonce, contractAddress, chainId) {
  const digest = buildSessionDigest(evId, stationId, nonce, contractAddress, chainId);
  return wallet.signMessage(getBytes(digest));
}

export function buildMeterDigest(sessionId, energyWh, session, contractAddress, chainId) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint64", "uint64", "uint256", "uint64", "address", "uint256"],
    [sessionId, energyWh, session.maxWh, session.pricePerWh, session.expiresAt, contractAddress, chainId]
  ));
}

export async function ensureSessionIdentity(registry, engineUrl, didHash, pubKey, isStation) {
  if (!registry) throw new Error("The EV trust registry is unavailable.");
  const entity = await registry.entities(didHash);
  if (entity.registered) {
    if (entity.isStation !== isStation || entity.pubKey.toLowerCase() !== pubKey.toLowerCase()) {
      throw new Error("This DID belongs to a different wallet or entity type. Select the matching wallet or DID.");
    }
    return;
  }
  const response = await fetch(`${engineUrl}/register-entity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ didHash, pubKey, isStation })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Identity registration failed.");
}

export function readSessionEvent(contract, receipt) {
  const address = contract.target.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;
    const event = contract.interface.parseLog(log);
    if (event?.name === "SessionAuthenticated" || event?.name === "SessionDenied") {
      return { authorized: event.name === "SessionAuthenticated", sessionId: event.args.sessionId };
    }
  }
  throw new Error("Registry transaction did not emit a session result.");
}
