import React from "react";
import { useWeb3 } from "../Web3Context.jsx";
import { shorten, CopyChip, Badge, icons } from "./ui.jsx";

export default function NavBar({ activeTab, setActiveTab }) {
  const { account, connectInjected, disconnect, deployment } = useWeb3();
  const course = deployment.mode === "course";

  function openSeparateWindow() {
    window.open(`${window.location.pathname}${window.location.search}#${activeTab}`, "_blank", "width=850,height=900");
  }

  return (
    <header className="app-header">
      <div className="brand">
        <div className="brand-mark">{icons.bolt}</div>
        <div>
          <h1>EV Charging Trust Network</h1>
          <p>
            Decentralized identity, mutual authentication & dynamic Beta-reputation on consortium blockchain.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <a href="/">Live charging network</a>
        {/* Navigation Tabs */}
        <nav className="portal-nav" aria-label="EV charging workspace" style={{ display: "flex", flexWrap: "wrap", gap: 6, background: "var(--surface)", padding: 4, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
          {course ? (
            <>
              <button className={activeTab === "customer" ? "" : "secondary"} aria-current={activeTab === "customer" ? "page" : undefined} onClick={() => setActiveTab("customer")}>Customer</button>
              <button className={activeTab === "station" ? "" : "secondary"} aria-current={activeTab === "station" ? "page" : undefined} onClick={() => setActiveTab("station")}>Station Owner</button>
              <button className={activeTab === "settlement" ? "" : "secondary"} onClick={() => setActiveTab("settlement")}>
                Charging and settlement
              </button>
            </>
          ) : <>
          <button
            className={activeTab === "customer" ? "" : "secondary"}
            style={{ fontSize: "0.82rem", padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab("customer")}
          >
            <span>🚗</span>
            <span>Customer Web</span>
          </button>
          <button
            className={activeTab === "station" ? "" : "secondary"}
            style={{ fontSize: "0.82rem", padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab("station")}
          >
            <span>⚡</span>
            <span>Charging Station</span>
          </button>
          </>}
          <button
            className={activeTab === "consortium" ? "" : "secondary"}
            style={{ fontSize: "0.82rem", padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab("consortium")}
          >
            <span>🛡️</span>
            <span>Consortium Console</span>
          </button>
          {!course && <button
            className={activeTab === "simulator" ? "" : "secondary"}
            style={{ fontSize: "0.82rem", padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
            onClick={() => setActiveTab("simulator")}
          >
            <span>🧪</span>
            <span>Simulator</span>
          </button>}
        </nav>

        {/* Pop-out button */}
        <button
          className="secondary tiny"
          onClick={openSeparateWindow}
          title="Open this portal in a dedicated standalone window for dual-screen testing"
        >
          Pop-out ↗
        </button>

        {/* MetaMask Connection Pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {account ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "1rem" }}>🦊</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: "0.78rem" }}>{shorten(account)}</span>
              <button className="ghost tiny" onClick={disconnect} style={{ padding: "2px 6px" }}>
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connectInjected}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #e2761b, #e4761b)", borderColor: "#d96500" }}
            >
              <span style={{ fontSize: "1rem" }}>🦊</span>
              <span>Connect MetaMask</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

