import React, { useState } from "react";
import { useWeb3 } from "../Web3Context.jsx";

export default function LoginModal() {
  const {
    isLoginModalOpen,
    setIsLoginModalOpen,
    connectInjected,
    connectDevWallet,
    error
  } = useWeb3();

  const [loading, setLoading] = useState(false);

  if (!isLoginModalOpen) return null;

  async function handleMetaMask() {
    setLoading(true);
    try {
      await connectInjected();
    } catch {} finally {
      setLoading(false);
    }
  }

  async function handleDev(index) {
    setLoading(true);
    try {
      await connectDevWallet(index);
    } catch {} finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px"
      }}
      onClick={() => setIsLoginModalOpen(false)}
    >
      <div
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius)",
          padding: "24px",
          maxWidth: "460px",
          width: "100%",
          boxShadow: "var(--shadow)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}>Authenticate Session</h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-muted)" }}>
              Authenticate your identity on the EV Trust Consortium chain.
            </p>
          </div>
          <button
            className="ghost tiny"
            style={{ fontSize: "1.2rem", lineHeight: 1 }}
            onClick={() => setIsLoginModalOpen(false)}
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="message bad" style={{ marginBottom: "16px" }}>
            <div className="msg-body">{error}</div>
          </div>
        )}

        <div style={{ display: "grid", gap: "14px" }}>
          <div>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Browser Extension
            </div>
            <button
              onClick={handleMetaMask}
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                fontSize: "0.95rem",
                background: "linear-gradient(135deg, #e2761b, #cd6116)",
                borderColor: "#b3500d"
              }}
            >
              <span style={{ fontSize: "1.3rem" }}>🦊</span>
              <strong>{loading ? "Connecting to MetaMask…" : "Connect with MetaMask"}</strong>
            </button>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              ⚡ 1-Click Dev Accounts (No Extension Required)
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              <button
                className="secondary"
                disabled={loading}
                onClick={() => handleDev(0)}
                style={{ textAlign: "left", padding: "8px 12px", fontSize: "0.85rem" }}
              >
                <strong>Account #0 — Consortium Admin & Oracle</strong>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
                  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
                </div>
              </button>
              <button
                className="secondary"
                disabled={loading}
                onClick={() => handleDev(1)}
                style={{ textAlign: "left", padding: "8px 12px", fontSize: "0.85rem" }}
              >
                <strong>Account #1 — Charging Station Operator</strong>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
                  0x70997970C51812dc3A010C7d01b50e0d17dc79C8
                </div>
              </button>
              <button
                className="secondary"
                disabled={loading}
                onClick={() => handleDev(2)}
                style={{ textAlign: "left", padding: "8px 12px", fontSize: "0.85rem" }}
              >
                <strong>Account #2 — Consortium Oracle #2</strong>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--mono)" }}>
                  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
                </div>
              </button>
            </div>
          </div>

          <div style={{ background: "var(--surface-2)", padding: "10px", borderRadius: "8px", fontSize: "0.76rem", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
            <strong>Local Consortium Chain:</strong>
            <div style={{ marginTop: 2 }}>RPC: <code>http://127.0.0.1:8545</code> · Chain ID: <code>31337</code></div>
          </div>
        </div>
      </div>
    </div>
  );
}
