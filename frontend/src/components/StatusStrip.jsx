import React, { useState } from "react";
import { useWeb3 } from "../Web3Context.jsx";
import { CopyChip, shorten, Badge } from "./ui.jsx";

function Cell({ label, children }) {
  return (
    <div className="status-cell">
      <div className="k">{label}</div>
      <div className="v">{children}</div>
    </div>
  );
}

export default function StatusStrip() {
  const {
    account,
    chainId,
    authMode,
    connect,
    disconnect,
    requestFaucet,
    hasWallet,
    chainStatus,
    engineStatus,
    contractAddress,
    minTrustScoreE4,
    requiredApprovals,
    deployment,
    connectInjected
  } = useWeb3();

  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState(false);

  const chainMismatch = account && chainStatus.chainId && chainId && chainId !== chainStatus.chainId;

  async function handleFaucet() {
    if (!account) return;
    setFaucetBusy(true);
    const res = await requestFaucet();
    setFaucetBusy(false);
    if (res.success) {
      setFaucetSuccess(true);
      setTimeout(() => setFaucetSuccess(false), 3000);
    }
  }

  return (
    <div className="status-strip">
      <Cell label="Blockchain node">
        <span className={`dot ${chainStatus.state === "live" ? "live" : "down"}`} />
        {chainStatus.state === "live"
          ? `Chain ${chainStatus.chainId} · block ${chainStatus.blockNumber}`
          : "Unreachable"}
      </Cell>

      <Cell label={deployment.mode === "course" ? "Registry API" : "Trust engine"}>
        <span className={`dot ${engineStatus.state === "live" ? "live" : "down"}`} />
        {engineStatus.state === "live" ? "Online" : "Offline"}
      </Cell>

      <Cell label="Registry contract">
        {contractAddress
          ? <CopyChip value={contractAddress} />
          : <span style={{ color: "var(--text-faint)" }}>Not deployed</span>}
      </Cell>

      <Cell label="Policy">
        {minTrustScoreE4 != null
          ? `Threshold ${(minTrustScoreE4 / 100).toFixed(0)}% · ${requiredApprovals}-of-N oracles`
          : "—"}
      </Cell>

      <Cell label="Session Auth">
        {account ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span className={`dot ${chainMismatch ? "idle" : "live"}`} />
            <span title={account} style={{ fontFamily: "var(--mono)", fontSize: "0.76rem" }}>
              {shorten(account, 6, 4)}
            </span>
            <Badge kind={authMode === "dev" ? "ok" : "neutral"}>
              {authMode === "dev" ? "Dev Signer" : authMode === "injected" ? "MetaMask" : "Web3"}
            </Badge>
            {deployment.mode !== "course" && <button
              className="ghost tiny"
              style={{ fontSize: "0.72rem", padding: "2px 6px" }}
              disabled={faucetBusy}
              onClick={handleFaucet}
              title="Request 25 test ETH and Admin/Registrar/Oracle roles"
            >
              {faucetSuccess ? "✓ Funded" : faucetBusy ? "..." : "+ Faucet"}
            </button>}
            <button
              className="ghost tiny"
              style={{ fontSize: "0.72rem", padding: "2px 6px", color: "var(--bad)" }}
              onClick={disconnect}
            >
              Logout
            </button>
          </div>
        ) : (
          <button className="primary tiny" onClick={deployment.mode === "course" ? connectInjected : connect} disabled={!hasWallet}>
            Authenticate / Login
          </button>
        )}
      </Cell>
    </div>
  );
}
