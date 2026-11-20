import React, { useState } from "react";
import { useWeb3, TRUST_ENGINE_URL } from "../Web3Context.jsx";
import deployment from "../deployedAddress.json";

export default function ConnectionBar() {
  const { account, chainId, connect, disconnect, error, contractAddress, setContractAddress } = useWeb3();
  const [faucetMsg, setFaucetMsg] = useState(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  const chainMismatch = account && deployment.chainId && chainId && chainId !== deployment.chainId;

  async function requestFaucet() {
    if (!account) return;
    setFaucetBusy(true);
    setFaucetMsg({ text: "Requesting test ETH & dev roles...", bad: false });
    try {
      const res = await fetch(`${TRUST_ENGINE_URL}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: account })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Faucet failed");
      setFaucetMsg({ text: "Granted Admin & Oracle roles + 25 test ETH!", bad: false });
      setTimeout(() => setFaucetMsg(null), 5000);
    } catch (err) {
      setFaucetMsg({ text: `Faucet error: ${err.message}`, bad: true });
    } finally {
      setFaucetBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row">
        <div className="field">
          <label>Registry contract address (auto-filled from the last local deploy)</label>
          <input
            type="text"
            placeholder="0x..."
            value={contractAddress}
            onChange={(e) => setContractAddress(e.target.value.trim())}
          />
        </div>
        {deployment.address && contractAddress !== deployment.address && (
          <button className="secondary" onClick={() => setContractAddress(deployment.address)}>
            Use latest deploy
          </button>
        )}
        <button onClick={connect}>{account ? "Reconnect" : "Login"}</button>
        {account && <button className="secondary" onClick={disconnect}>Logout</button>}
        {account && (
          <button className="secondary" disabled={faucetBusy} onClick={requestFaucet}>
            {faucetBusy ? "Funding..." : "Dev Faucet & Roles"}
          </button>
        )}
      </div>
      <div className="status-line">
        {account ? `Connected as ${account}${chainId ? ` (chain ${chainId})` : ""}` : "Not logged in"}
      </div>
      {faucetMsg && (
        <div className={`status-line ${faucetMsg.bad ? "bad" : ""}`}>{faucetMsg.text}</div>
      )}
      {deployment.deployedAt && (
        <div className="status-line">Last local deploy: {new Date(deployment.deployedAt).toLocaleString()}</div>
      )}
      {chainMismatch && (
        <div className="status-line bad">
          Wallet is on chain {chainId} but the contract was deployed on chain {deployment.chainId} — switch networks in your wallet.
        </div>
      )}
      {error && <div className="status-line bad">{error}</div>}
    </div>
  );
}
