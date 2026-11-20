export function formatErrorMessage(err, contract) {
  if (!err) return "Unknown error";

  // 1. Try extracting custom errors from ABI
  const errorData = err.data || err.error?.data?.data || err.error?.data || err.info?.error?.data;
  if (errorData && typeof errorData === "string" && contract?.interface) {
    try {
      const parsed = contract.interface.parseError(errorData);
      if (parsed) {
        if (parsed.name === "AccessControlUnauthorizedAccount") {
          return `Access Denied: Account ${parsed.args[0]} does not hold the required role (${parsed.args[1]}). Authenticate with Dev Account #0 (Consortium Admin) or click Faucet.`;
        }
        return `Contract Reverted: ${parsed.name}(${parsed.args ? parsed.args.join(", ") : ""})`;
      }
    } catch {}
  }

  // 2. Search for common revert strings inside nested error messages
  const fullErrorString = [
    err.reason,
    err.message,
    err.error?.message,
    err.info?.error?.message,
    typeof err.error === "string" ? err.error : ""
  ].filter(Boolean).join(" ");

  // Check for common EVTrustRegistry require messages
  if (fullErrorString.includes("ev sig invalid")) {
    return "Authentication failed: EV signature is invalid (signature does not match the registered EV public key).";
  }
  if (fullErrorString.includes("station sig invalid")) {
    return "Authentication failed: Station signature is invalid (signature does not match the registered Station public key).";
  }
  if (fullErrorString.includes("nonce reused")) {
    return "Authentication failed: Nonce has already been used. Each charging session requires a unique challenge nonce.";
  }
  if (fullErrorString.includes("bad ev")) {
    return "Authentication failed: EV identity is either not registered or is registered as a station instead of an electric vehicle.";
  }
  if (fullErrorString.includes("bad station")) {
    return "Authentication failed: Station identity is either not registered or is not marked as a charging station.";
  }
  if (fullErrorString.includes("already registered")) {
    return "Registration failed: Entity DID is already registered on-chain.";
  }
  if (fullErrorString.includes("already approved")) {
    return "Approval rejected: This oracle account has already approved this proposal.";
  }
  if (fullErrorString.includes("already executed")) {
    return "Proposal has already reached consensus and executed.";
  }
  if (fullErrorString.includes("score out of range")) {
    return "Score out of range: Trust scores must be between 0 and 10000 (0% to 100%).";
  }
  if (fullErrorString.includes("need >=1 approval")) {
    return "Invalid quorum: Required oracle approvals must be at least 1.";
  }

  // 3. Check for revert reason extraction: e.g. reverted with reason string '...'
  const match = fullErrorString.match(/reverted with reason string ['"]([^'"]+)['"]/);
  if (match && match[1]) {
    return `Transaction reverted: ${match[1]}`;
  }

  const panicMatch = fullErrorString.match(/reverted with panic code 0x([0-9a-fA-F]+)/);
  if (panicMatch) {
    return `Transaction reverted with panic code 0x${panicMatch[1]}`;
  }

  // 4. Handle ethers "could not coalesce error" and RPC unauthorized / rejection
  if (fullErrorString.includes("has not been authorized") || err.code === 4100 || err.info?.error?.code === 4100) {
    return "MetaMask authorization error: The requested account is not authorized or the network was not approved. Please open MetaMask, connect your account to Hardhat Local (Chain 31337), or use a 1-Click Dev Account.";
  }
  if (fullErrorString.includes("user rejected") || err.code === 4001 || err.info?.error?.code === 4001) {
    return "Action was cancelled in MetaMask by the user.";
  }

  if (err.shortMessage && err.shortMessage.includes("could not coalesce")) {
    const rawMsg = err.info?.error?.message || err.error?.message;
    if (rawMsg) {
      if (rawMsg.includes("has not been authorized") || rawMsg.includes("4100")) {
        return "MetaMask authorization error: The requested account is not authorized in your wallet. Please approve the connection in MetaMask, switch to Hardhat Local (Chain 31337), or use a 1-Click Dev Account.";
      }
      return `Blockchain RPC error: ${rawMsg}`;
    }
    return "Contract call failed on local node. The contract address may be stale or the transaction reverted.";
  }

  if (err.reason) return err.reason;
  if (err.shortMessage && !err.shortMessage.includes("could not coalesce")) {
    return err.shortMessage;
  }

  return err.message || String(err);
}