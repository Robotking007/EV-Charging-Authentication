import React from "react";
import { useWeb3 } from "../Web3Context.jsx";

/**
 * Explains what is missing rather than dead-ending on an error string:
 * read-only panels still work without a wallet, so the banner says exactly
 * which capability is unavailable and how to enable it.
 */
export default function SetupBanner() {
  const { hasWallet, account, chainId, chainStatus, contractAddress, minTrustScoreE4, error, connect, deployment, connectInjected } = useWeb3();
  const course = deployment.mode === "course";
  const deployCommand = course ? "npm run besu:deploy" : "npm run deploy:local";

  if (chainStatus.state === "down") {
    return (
      <div className="banner">
        <strong>Blockchain node unreachable.</strong> Start the local chain, then deploy:
        <ol>
          <li><code>{course ? "npm run besu:up" : "npx hardhat node"}</code></li>
          <li><code>{deployCommand}</code></li>
        </ol>
      </div>
    );
  }

  if (!contractAddress) {
    return (
      <div className="banner">
        <strong>No contract deployed yet.</strong> Run{" "}
        <code>{deployCommand}</code> — the address is
        written straight into this console.
      </div>
    );
  }

  if (chainStatus.state === "live" && minTrustScoreE4 === null) {
    return (
      <div className="banner">
        <strong>Registry unavailable at the configured address.</strong> Deploy it with{" "}
        <code>{deployCommand}</code>.
      </div>
    );
  }

  if (!hasWallet && !course) {
    return (
      <div className="banner">
        <strong>Login starting up.</strong> Entity lookup, the live event log and the
        trust-engine actions work while this loads, but on-chain writes need the login modal to
        finish initializing.
      </div>
    );
  }

  if (!account) {
    return (
      <div className="banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <strong>Read-only mode.</strong> {course ? "Connect a funded Besu wallet to sign and submit transactions." : "Authenticate to submit transactions with MetaMask or a Dev Signer."}
          {error && <div>{error}</div>}
        </div>
        <button className="secondary tiny" onClick={course ? connectInjected : connect} style={{ whiteSpace: "nowrap" }}>
          Authenticate Now
        </button>
      </div>
    );
  }

  if (chainStatus.chainId && chainId && chainId !== chainStatus.chainId) {
    return (
      <div className="banner">
        <strong>Wrong network.</strong> Your session is on chain {chainId} but the contract lives
        on chain {chainStatus.chainId}.
      </div>
    );
  }

  if (error) return <div className="banner"><strong>Wallet error.</strong> {error}</div>;

  return null;
}
