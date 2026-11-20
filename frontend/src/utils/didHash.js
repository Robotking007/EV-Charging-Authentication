import { keccak256, toUtf8Bytes, isHexString } from "ethers";

/** Accepts either a raw human-readable DID string or an already-hex bytes32 hash. */
export function toDidHash(idOrHash) {
  const trimmed = (idOrHash || "").trim();
  if (isHexString(trimmed, 32)) return trimmed;
  return keccak256(toUtf8Bytes(trimmed));
}
