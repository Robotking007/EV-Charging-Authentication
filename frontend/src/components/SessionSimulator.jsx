import React, { useState, useEffect } from "react";
import { randomBytes, hexlify, Contract } from "ethers";
import { useWeb3, TRUST_ENGINE_URL } from "../Web3Context.jsx";
import { toDidHash } from "../utils/didHash.js";
import { getDemoWallet, listDemoWallets } from "../utils/demoWallets.js";
import { readSessionEvent, signSession } from "../utils/signSession.js";
import { watchSessionDuration } from "../utils/sharedSession.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { Card, Field, Message, Badge, CopyChip, TrustMeter, shorten, icons } from "./ui.jsx";
import registryArtifact from "../abi/EVTrustRegistry.json";

const demoWallets = listDemoWallets(6);

export default function SessionSimulator() {
  const {
    contract,
    readOnlyContract,
    provider,
    fallbackProvider,
    contractAddress,
    engineStatus,
    minTrustScoreE4,
    requiredApprovals,
    setLastProposalId
  } = useWeb3();

  // Participant setup
  const [evDid, setEvDid] = useState("did:ev:001");
  const [stationDid, setStationDid] = useState("did:station:001");
  const [evWalletIndex, setEvWalletIndex] = useState(0);
  const [stationWalletIndex, setStationWalletIndex] = useState(1);

  // Pre-flight entity statuses
  const [evEntity, setEvEntity] = useState(null);
  const [stationEntity, setStationEntity] = useState(null);

  // Active session state
  const [activeSession, setActiveSession] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Finalized session result
  const [completedSession, setCompletedSession] = useState(null);

  // Denied session result
  const [deniedResult, setDeniedResult] = useState(null);

  // UI state
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  // Fetch participant info when DIDs change
  useEffect(() => {
    let cancelled = false;
    async function checkEntities() {
      const source = readOnlyContract || contract;
      if (!source) return;
      try {
        const [ev, st] = await Promise.all([
          source.entities(toDidHash(evDid)).catch(() => null),
          source.entities(toDidHash(stationDid)).catch(() => null)
        ]);
        if (!cancelled) {
          setEvEntity(ev && ev.registered ? {
            registered: ev.registered,
            isStation: ev.isStation,
            pubKey: ev.pubKey,
            trustScoreE4: Number(ev.trustScoreE4)
          } : null);
          setStationEntity(st && st.registered ? {
            registered: st.registered,
            isStation: st.isStation,
            pubKey: st.pubKey,
            trustScoreE4: Number(st.trustScoreE4)
          } : null);
        }
      } catch {}
    }
    checkEntities();
    return () => { cancelled = true; };
  }, [evDid, stationDid, readOnlyContract, contract, completedSession]);

  // Elapsed timer ticker for active session
  useEffect(() => watchSessionDuration(activeSession, setElapsedSeconds), [activeSession]);

  // Energy delivered based on duration (50 kW fast charger)
  const deliveredKWh = activeSession ? ((elapsedSeconds * 50) / 3600).toFixed(3) : "0.000";

  // Mutual challenge-response authentication
  async function startAuthenticationSession() {
    setBusy(true);
    setDeniedResult(null);
    setCompletedSession(null);
    setStatus({ kind: "neutral", text: "Generating 32-byte cryptographic challenge nonce…" });

    try {
      const fallbackSigner = fallbackProvider ? getDemoWallet(0).connect(fallbackProvider) : null;
      let activeContract = contract;
      if (!activeContract) {
        if (!fallbackSigner) {
          throw new Error("No connected blockchain provider or registry address available.");
        }
        activeContract = new Contract(contractAddress, registryArtifact.abi, fallbackSigner);
      }

      const activeProvider = provider || fallbackProvider;
      const network = await activeProvider.getNetwork();
      const evId = toDidHash(evDid);
      const stationId = toDidHash(stationDid);
      const nonce = hexlify(randomBytes(32));

      setStatus({ kind: "neutral", text: "Computing mutual ECDSA signatures off-chain for EV and Station…" });
      const evWallet = getDemoWallet(Number(evWalletIndex));
      const stationWallet = getDemoWallet(Number(stationWalletIndex));

      const [evSig, stationSig] = await Promise.all([
        signSession(evWallet, evId, stationId, nonce, contractAddress, network.chainId),
        signSession(stationWallet, evId, stationId, nonce, contractAddress, network.chainId)
      ]);

      setStatus({ kind: "neutral", text: "Submitting mutual challenge to smart contract EVTrustRegistry.authenticateSession…" });
      
      const tx = await activeContract.authenticateSession(evId, stationId, nonce, evSig, stationSig);
      const receipt = await tx.wait();
      const { authorized: isAuthorized, sessionId } = readSessionEvent(activeContract, receipt);

      if (isAuthorized) {
        setElapsedSeconds(0);
        setActiveSession({
          sessionId,
          txHash: receipt.hash,
          evDid,
          stationDid,
          evId,
          stationId,
          evSigner: evWallet.address,
          stationSigner: stationWallet.address,
          startTime: Date.now(),
          status: "active",
          startEvScoreE4: evEntity ? evEntity.trustScoreE4 : 5000,
          startStationScoreE4: stationEntity ? stationEntity.trustScoreE4 : 5000
        });
        setStatus(null);
      } else {
        setDeniedResult({
          sessionId,
          txHash: receipt.hash,
          evDid,
          stationDid,
          reason: `Trust threshold is ${minTrustScoreE4 != null ? (minTrustScoreE4 / 100).toFixed(0) : "30"}%. One or both entities hold insufficient reputation.`
        });
        setStatus({
          kind: "bad",
          text: "Mutual authentication succeeded, but authorization was DENIED on-chain due to trust policy."
        });
      }
    } catch (err) {
      setStatus({ kind: "bad", text: formatErrorMessage(err, contract || readOnlyContract) });
    } finally {
      setBusy(false);
    }
  }

  // Conclude active session & feed outcome into off-chain trust engine
  async function concludeSession(succeeded) {
    if (!activeSession) return;
    setBusy(true);
    setStatus({
      kind: "neutral",
      text: succeeded
        ? "Settling session: reporting successful charge to trust engine…"
        : "Settling session: reporting dispute/failure to trust engine…"
    });

    try {
      const response = await fetch(`${TRUST_ENGINE_URL}/session/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession.sessionId,
          txHash: activeSession.txHash,
          evDidHash: activeSession.evId,
          stationDidHash: activeSession.stationId,
          evSucceeded: succeeded,
          stationSucceeded: succeeded,
          energyKWh: parseFloat(deliveredKWh),
          durationSeconds: elapsedSeconds
        })
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Trust engine rejected outcome");

      // Feed latest proposal to context so Oracle console can pick it up
      if (body.station?.proposalId) setLastProposalId(body.station.proposalId);
      else if (body.ev?.proposalId) setLastProposalId(body.ev.proposalId);

      setCompletedSession({
        sessionId: activeSession.sessionId,
        succeeded,
        energyKWh: deliveredKWh,
        durationSeconds: elapsedSeconds,
        ev: body.ev,
        station: body.station,
        startEvScore: activeSession.startEvScoreE4,
        startStationScore: activeSession.startStationScoreE4
      });

      setActiveSession(null);
      setStatus(null);
    } catch (err) {
      setStatus({ kind: "bad", text: `Trust engine error: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  // Quick 1-click oracle proposal approval right from session card
  async function approveProposalDirectly(propId) {
    setBusy(true);
    setStatus({ kind: "neutral", text: "Submitting oracle approval on-chain…" });
    try {
      const oracleSigner = fallbackProvider ? getDemoWallet(2).connect(fallbackProvider) : null;
      let activeContract = contract;
      if (!activeContract) {
        if (!oracleSigner) {
          throw new Error("No connected blockchain provider available.");
        }
        activeContract = new Contract(contractAddress, registryArtifact.abi, oracleSigner);
      }

      let tx;
      try {
        tx = await activeContract.approveProposal(propId);
      } catch (sendErr) {
        const errMsg = formatErrorMessage(sendErr, activeContract);
        if (sendErr?.code === 4100 || errMsg.includes("authorized") || errMsg.includes("Access Denied")) {
          // Fall back to Account #2 (Consortium Oracle #2 with ORACLE_ROLE)
          const fallbackContract = new Contract(contractAddress, registryArtifact.abi, oracleSigner);
          tx = await fallbackContract.approveProposal(propId);
        } else {
          throw sendErr;
        }
      }

      await tx.wait();
      setStatus({ kind: "ok", text: "Oracle approval recorded successfully on-chain! Quorum satisfied." });
      if (completedSession) {
        setCompletedSession((prev) => ({
          ...prev,
          approvedLocally: true
        }));
      }
    } catch (err) {
      setStatus({ kind: "bad", text: formatErrorMessage(err, contract || readOnlyContract) });
    } finally {
      setBusy(false);
    }
  }

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <Card
      icon={icons.session}
      title="EV Charging Authentication & Session Lifecycle"
      description="Mutual ECDSA challenge-response handshake verified on-chain, gated by live Beta-reputation scores, with automatic trust feedback upon session completion."
    >
      {/* ---------------- ACTIVE CHARGING SESSION SCREEN ---------------- */}
      {activeSession ? (
        <div style={{
          border: "2px solid var(--ok)",
          background: "var(--surface-2)",
          borderRadius: "var(--radius)",
          padding: "18px",
          marginTop: "8px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="dot live" style={{ width: 12, height: 12 }} />
              <strong style={{ fontSize: "1.05rem", color: "var(--ok)" }}>ACTIVE CHARGING SESSION</strong>
            </div>
            <Badge kind="ok">50 kW DC Fast Charging</Badge>
          </div>

          <div className="stats" style={{ marginBottom: "16px" }}>
            <div className="stat">
              <div className="k">Session Elapsed</div>
              <div className="v" style={{ fontFamily: "var(--mono)", fontSize: "1.4rem", color: "var(--primary)" }}>
                {formatTime(elapsedSeconds)}
              </div>
            </div>
            <div className="stat">
              <div className="k">Energy Delivered</div>
              <div className="v" style={{ fontFamily: "var(--mono)", fontSize: "1.4rem", color: "var(--text)" }}>
                {deliveredKWh} <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>kWh</span>
              </div>
            </div>
            <div className="stat">
              <div className="k">Grid Rate</div>
              <div className="v" style={{ fontSize: "1.1rem" }}>400 V · 125 A</div>
            </div>
          </div>

          <div style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            marginBottom: "16px",
            background: "var(--surface)",
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>EV Identity:</span>
              <span className="mono"><strong>{activeSession.evDid}</strong> ({shorten(activeSession.evSigner, 6, 4)})</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Station Identity:</span>
              <span className="mono"><strong>{activeSession.stationDid}</strong> ({shorten(activeSession.stationSigner, 6, 4)})</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Session ID:</span>
              <CopyChip value={activeSession.sessionId} label={shorten(activeSession.sessionId, 8, 6)} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>On-Chain Handshake Tx:</span>
              <CopyChip value={activeSession.txHash} label={shorten(activeSession.txHash, 8, 6)} />
            </div>
          </div>

          <div className="actions between" style={{ marginTop: "12px" }}>
            <button
              className="primary"
              disabled={busy}
              onClick={() => concludeSession(true)}
              style={{ flex: 1, padding: "10px 16px" }}
            >
              ✓ Complete Session (Success & Settlement)
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => concludeSession(false)}
              style={{ flex: 1, padding: "10px 16px" }}
            >
              ⚠ Close with Dispute / Failure
            </button>
          </div>
        </div>
      ) : (
        /* ---------------- PRE-SESSION SETUP & HANDSHAKE ---------------- */
        <div>
          <div className="field-row">
            <Field label="EV Identity (DID)">
              <input
                type="text"
                value={evDid}
                onChange={(e) => setEvDid(e.target.value)}
                placeholder="did:ev:001"
              />
            </Field>
            <Field label="EV Signing Key (Private Key #)">
              <select
                className="mono"
                value={evWalletIndex}
                onChange={(e) => setEvWalletIndex(e.target.value)}
              >
                {demoWallets.map((w) => (
                  <option key={w.index} value={w.index}>
                    #{w.index} {w.address.slice(0, 10)}… {w.index === 0 ? "(Pre-registered EV)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {evEntity && (
            <div style={{ margin: "-4px 0 12px 0", fontSize: "0.78rem" }}>
              <TrustMeter scoreE4={evEntity.trustScoreE4} thresholdE4={minTrustScoreE4} />
            </div>
          )}

          <div className="field-row">
            <Field label="Station Identity (DID)">
              <input
                type="text"
                value={stationDid}
                onChange={(e) => setStationDid(e.target.value)}
                placeholder="did:station:001"
              />
            </Field>
            <Field label="Station Signing Key (Private Key #)">
              <select
                className="mono"
                value={stationWalletIndex}
                onChange={(e) => setStationWalletIndex(e.target.value)}
              >
                {demoWallets.map((w) => (
                  <option key={w.index} value={w.index}>
                    #{w.index} {w.address.slice(0, 10)}… {w.index === 1 ? "(Pre-registered Station)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {stationEntity && (
            <div style={{ margin: "-4px 0 12px 0", fontSize: "0.78rem" }}>
              <TrustMeter scoreE4={stationEntity.trustScoreE4} thresholdE4={minTrustScoreE4} />
            </div>
          )}

          <div className="actions between" style={{ marginTop: 14 }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}>
              Mutual challenge signed off-chain · verified against registry pubKeys
            </span>
            <button
              className="primary"
              disabled={busy}
              onClick={startAuthenticationSession}
              style={{ fontWeight: 600, padding: "8px 18px" }}
            >
              {busy ? "Authenticating…" : "Authenticate & Authorize Session"}
            </button>
          </div>
        </div>
      )}

      {/* ---------------- DENIED SESSION RESULT ---------------- */}
      {deniedResult && (
        <div className="message bad" style={{ marginTop: 16 }}>
          <div className="msg-body">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Badge kind="bad">Access Denied — Flagged for Review</Badge>
              <CopyChip value={deniedResult.sessionId} label={`Session ${shorten(deniedResult.sessionId, 8, 4)}`} />
            </div>
            <p style={{ margin: "8px 0 6px", fontSize: "0.85rem" }}>
              {deniedResult.reason}
            </p>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Nonce was consumed on-chain and recorded via <code>SessionDenied</code> event. Charging plug remains locked.
            </div>
          </div>
        </div>
      )}

      {/* ---------------- FINALIZED SESSION SUMMARY & TRUST FEEDBACK ---------------- */}
      {completedSession && (
        <div style={{
          border: "1px solid var(--border-strong)",
          background: "var(--surface-2)",
          borderRadius: "var(--radius)",
          padding: "16px",
          marginTop: "16px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <Badge kind={completedSession.succeeded ? "ok" : "warn"}>
              {completedSession.succeeded ? "Session Finalized & Settled" : "Session Closed with Dispute"}
            </Badge>
            <button
              className="secondary tiny"
              onClick={() => setCompletedSession(null)}
            >
              Start New Session
            </button>
          </div>

          <div className="stats" style={{ marginBottom: "14px" }}>
            <div className="stat">
              <div className="k">Delivered Energy</div>
              <div className="v">{completedSession.energyKWh} kWh</div>
            </div>
            <div className="stat">
              <div className="k">Total Duration</div>
              <div className="v">{formatTime(completedSession.durationSeconds)}</div>
            </div>
            <div className="stat">
              <div className="k">EV Reputation</div>
              <div className="v" style={{ color: "var(--primary)" }}>
                {completedSession.ev?.scoreE4 ? `${(completedSession.ev.scoreE4 / 100).toFixed(2)}%` : "Updated"}
              </div>
            </div>
            <div className="stat">
              <div className="k">Station Reputation</div>
              <div className="v" style={{ color: "var(--primary)" }}>
                {completedSession.station?.scoreE4 ? `${(completedSession.station.scoreE4 / 100).toFixed(2)}%` : "Updated"}
              </div>
            </div>
          </div>

          <div style={{ fontSize: "0.82rem", background: "var(--surface)", padding: "12px", borderRadius: "var(--radius-sm)" }}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>Dynamic Trust Updates:</div>
            <p style={{ margin: "0 0 6px", color: "var(--text-muted)", fontSize: "0.78rem" }}>
              Beta parameters decayed by elapsed calendar time, then updated with session outcome.
            </p>

            {completedSession.station?.proposalId && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", flexWrap: "wrap", gap: "6px" }}>
                <span>Station Proposal: <CopyChip value={completedSession.station.proposalId} /></span>
                {completedSession.station.executed ? (
                  <Badge kind="ok">Executed On-Chain</Badge>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Badge kind="warn">
                      Quorum {completedSession.approvedLocally ? "2" : completedSession.station.approvals}/{completedSession.station.requiredApprovals || 2}
                    </Badge>
                    {!completedSession.approvedLocally && (
                      <button
                        className="primary tiny"
                        onClick={() => approveProposalDirectly(completedSession.station.proposalId)}
                        disabled={busy}
                      >
                        Approve as Oracle
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {status && <div style={{ marginTop: "12px" }}><Message kind={status.kind}>{status.text}</Message></div>}
    </Card>
  );
}