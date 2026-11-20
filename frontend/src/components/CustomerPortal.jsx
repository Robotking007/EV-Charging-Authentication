import React, { useState, useEffect } from "react";
import { randomBytes, hexlify, getBytes, Contract } from "ethers";
import { useWeb3, TRUST_ENGINE_URL } from "../Web3Context.jsx";
import { toDidHash } from "../utils/didHash.js";
import { buildSessionDigest, ensureSessionIdentity, readSessionEvent } from "../utils/signSession.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { getDemoWallet } from "../utils/demoWallets.js";
import {
  DEFAULT_STATIONS,
  getActiveSession,
  setActiveSession,
  getSessionHistory,
  addSessionHistory,
  setPendingRequest,
  subscribeToSessionStorage,
  watchSessionDuration
} from "../utils/sharedSession.js";
import { Card, Field, Message, Badge, CopyChip, TrustMeter, shorten, icons } from "./ui.jsx";
import registryArtifact from "../abi/EVTrustRegistry.json";

export default function CustomerPortal() {
  const {
    contract,
    readOnlyContract,
    signer,
    account,
    fallbackProvider,
    contractAddress,
    minTrustScoreE4,
    connectInjected,
    setLastProposalId,
    deployment
  } = useWeb3();

  // Driver identity
  const [evDid, setEvDid] = useState(() => {
    return account ? `did:ev:${account.slice(2, 8).toLowerCase()}` : "did:ev:driver-01";
  });
  const [selectedStation, setSelectedStation] = useState(DEFAULT_STATIONS[0].did);

  // Update default DID when account changes
  useEffect(() => {
    if (account) {
      setEvDid((prev) => (prev.startsWith("did:ev:driver-01") ? `did:ev:${account.slice(2, 8).toLowerCase()}` : prev));
    }
  }, [account]);

  // On-chain entity profiles
  const [evEntity, setEvEntity] = useState(null);
  const [stationEntity, setStationEntity] = useState(null);

  // Active session and timer
  const [session, setSession] = useState(getActiveSession);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [history, setHistory] = useState(getSessionHistory);

  // UI state
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [completedSession, setCompletedSession] = useState(null);
  const [deniedResult, setDeniedResult] = useState(null);

  // Sync with global storage events
  useEffect(() => {
    const handleSessionChange = (e) => setSession(e.detail);
    const handleHistoryChange = (e) => setHistory(e.detail);
    window.addEventListener("ev_session_change", handleSessionChange);
    window.addEventListener("ev_history_change", handleHistoryChange);
    const unsubscribe = subscribeToSessionStorage({ session: setSession, history: setHistory });
    return () => {
      unsubscribe();
      window.removeEventListener("ev_session_change", handleSessionChange);
      window.removeEventListener("ev_history_change", handleHistoryChange);
    };
  }, []);

  // Fetch on-chain status of EV and selected station
  useEffect(() => {
    let cancelled = false;
    async function loadEntityData() {
      const source = readOnlyContract || contract;
      if (!source) return;
      try {
        const evId = toDidHash(evDid);
        const stId = toDidHash(selectedStation);
        const [ev, st] = await Promise.all([
          source.entities(evId).catch(() => null),
          source.entities(stId).catch(() => null)
        ]);

        if (!cancelled) {
          setEvEntity(ev && ev.registered ? {
            registered: ev.registered,
            isStation: ev.isStation,
            pubKey: ev.pubKey,
            trustScoreE4: Number(ev.trustScoreE4),
            sessionsTotal: Number(ev.sessionsTotal),
            sessionsFailed: Number(ev.sessionsFailed)
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
    loadEntityData();
    return () => { cancelled = true; };
  }, [evDid, selectedStation, readOnlyContract, contract, completedSession]);

  // Charging session duration timer
  useEffect(() => watchSessionDuration(session, setElapsedSeconds), [session]);

  const deliveredKWh = session ? ((elapsedSeconds * 50) / 3600).toFixed(3) : "0.000";
  const sessionCost = (parseFloat(deliveredKWh) * 0.35).toFixed(2);
  const batteryPct = Math.min(100, 25 + Math.floor(elapsedSeconds / 3));

  // 1-Click register user's MetaMask address as an EV identity
  async function registerEvIdentity() {
    if (!account) {
      connectInjected();
      return;
    }
    setBusy(true);
    setStatus({ kind: "neutral", text: "Registering your MetaMask account as an EV on the consortium chain…" });
    try {
      const evId = toDidHash(evDid);
      // Try direct backend registrar endpoint first (instant and gasless)
      const res = await fetch(`${TRUST_ENGINE_URL}/register-entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ didHash: evId, pubKey: account, isStation: false })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      setStatus({ kind: "ok", text: `Successfully registered ${evDid} linked to ${shorten(account)}!` });
      setEvEntity({
        registered: true,
        isStation: false,
        pubKey: account,
        trustScoreE4: 5000,
        sessionsTotal: 0,
        sessionsFailed: 0
      });
    } catch (err) {
      setStatus({ kind: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Request a charging session: User signs in MetaMask or active wallet
  async function initiateChargeRequest() {
    setBusy(true);
    setDeniedResult(null);
    setCompletedSession(null);
    setStatus({ kind: "neutral", text: "Connecting wallet and generating challenge nonce…" });

    try {
      const targetChainId = Number(deployment?.chainId || 31337);
      let activeSigner = signer;
      let activeAccount = account;

      // If user isn't connected yet, check if MetaMask is available or connect
      if (!activeSigner || !activeAccount) {
        if (typeof window !== "undefined" && window.ethereum) {
          setStatus({ kind: "neutral", text: "Connecting to MetaMask…" });
          activeSigner = await connectInjected();
          if (!activeSigner) throw new Error("Wallet connection did not complete.");
          activeAccount = await activeSigner.getAddress();
        } else if (fallbackProvider) {
          const demoEvWallet = getDemoWallet(0).connect(fallbackProvider);
          activeSigner = demoEvWallet;
          activeAccount = demoEvWallet.address;
        } else {
          throw new Error("No wallet or blockchain provider available. Please connect MetaMask or start the chain.");
        }
      }

      const evId = toDidHash(evDid);
      const stationId = toDidHash(selectedStation);
      const nonce = hexlify(randomBytes(32));

      await ensureSessionIdentity(readOnlyContract, TRUST_ENGINE_URL, evId, activeAccount, false);

      // 3. Build challenge digest
      const digest = buildSessionDigest(evId, stationId, nonce, contractAddress, targetChainId);

      // 4. Cryptographic signature request
      setStatus({ kind: "neutral", text: "Please approve cryptographic signature request in wallet…" });
      const evSig = await activeSigner.signMessage(getBytes(digest));

      // 5. Obtain Station countersignature:
      // Check if station is an automated station on the consortium network
      setStatus({ kind: "neutral", text: "Verifying station credentials and countersignature…" });
      let stationSig = null;
      try {
        const csRes = await fetch(`${TRUST_ENGINE_URL}/station/countersign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evId, stationId, nonce })
        });
        if (csRes.ok) {
          const csData = await csRes.json();
          stationSig = csData.stationSig;
        }
      } catch {}

      // If station is not an automated network charger, broadcast request to Station Portal
      if (!stationSig) {
        setPendingRequest({
          evDid,
          stationDid: selectedStation,
          evId,
          stationId,
          nonce,
          evSig,
          digest,
          createdAt: Date.now()
        });
        setStatus({
          kind: "neutral",
          text: "Handshake request broadcast to Charging Station! Waiting for station operator to countersign in MetaMask…"
        });
        setBusy(false);
        return;
      }

      // 6. Submit mutual authentication to smart contract EVTrustRegistry.authenticateSession
      setStatus({ kind: "neutral", text: "Submitting mutual challenge to smart contract EVTrustRegistry.authenticateSession…" });
      
      let isAuthorized = false;
      let sessionId = hexlify(randomBytes(32));
      let txHash = "";
      let submitted = false;

      // Try sending from active signer first
      try {
        const activeContract = new Contract(contractAddress, registryArtifact.abi, activeSigner);
        const tx = await activeContract.authenticateSession(evId, stationId, nonce, evSig, stationSig);
        submitted = true;
        const receipt = await tx.wait();
        txHash = receipt.hash;
        ({ authorized: isAuthorized, sessionId } = readSessionEvent(activeContract, receipt));
      } catch (sendErr) {
        if (submitted || sendErr.code !== "INSUFFICIENT_FUNDS") throw sendErr;
      }

      // Relay a signed session if the wallet lacks test ETH.
      if (!submitted) {
        const relayRes = await fetch(`${TRUST_ENGINE_URL}/session/authenticate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evId, stationId, nonce, evSig, stationSig })
        });
        const relayData = await relayRes.json();
        if (!relayRes.ok) throw new Error(relayData.error || "Session authentication failed on-chain.");

        isAuthorized = relayData.authorized;
        sessionId = relayData.sessionId || sessionId;
        txHash = relayData.txHash || "";
      }

      if (isAuthorized) {
        const newSession = {
          sessionId,
          txHash,
          evDid,
          stationDid: selectedStation,
          evId,
          stationId,
          evSigner: activeAccount,
          startTime: Date.now(),
          status: "active",
          startEvScoreE4: evEntity ? evEntity.trustScoreE4 : 5000,
          startStationScoreE4: stationEntity ? stationEntity.trustScoreE4 : 5000
        };
        setElapsedSeconds(0);
        setActiveSession(newSession);
        setSession(newSession);
        setStatus({ kind: "ok", text: "Mutual authentication verified & authorized on-chain! Dispenser started." });
      } else {
        setDeniedResult({
          sessionId,
          txHash,
          evDid,
          stationDid: selectedStation,
          reason: `On-chain trust threshold is ${minTrustScoreE4 != null ? (minTrustScoreE4 / 100).toFixed(0) : "30"}%. One or both parties hold insufficient reputation.`
        });
        setStatus({
          kind: "bad",
          text: "Mutual signature check passed, but access was DENIED on-chain due to low trust score."
        });
      }
    } catch (err) {
      setStatus({ kind: "bad", text: formatErrorMessage(err, contract || readOnlyContract) });
    } finally {
      setBusy(false);
    }
  }

  // Stop charging & finalize session
  async function concludeSession(succeeded) {
    if (!session) return;
    setBusy(true);
    setStatus({
      kind: "neutral",
      text: succeeded
        ? "Settling session: reporting successful charge to Trust Engine feedback loop…"
        : "Settling session: reporting dispute to Trust Engine feedback loop…"
    });

    try {
      const response = await fetch(`${TRUST_ENGINE_URL}/session/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          txHash: session.txHash || undefined,
          evDidHash: session.evId,
          stationDidHash: session.stationId,
          evSucceeded: succeeded,
          stationSucceeded: succeeded,
          energyKWh: parseFloat(deliveredKWh),
          durationSeconds: elapsedSeconds
        })
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Trust engine rejected outcome");

      if (body.ev?.proposalId) setLastProposalId(body.ev.proposalId);

      const completed = {
        sessionId: session.sessionId,
        succeeded,
        stationDid: session.stationDid,
        evDid: session.evDid,
        energyKWh: deliveredKWh,
        durationSeconds: elapsedSeconds,
        cost: sessionCost,
        completedAt: new Date().toLocaleTimeString(),
        ev: body.ev,
        station: body.station
      };

      setCompletedSession(completed);
      addSessionHistory(completed);
      setActiveSession(null);
      setSession(null);
      setStatus({ kind: "ok", text: "Charging session finalized and recorded in the reputation engine!" });
    } catch (err) {
      setStatus({ kind: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-container">
      {/* Driver Identity Card */}
      <Card
        icon={icons.session}
        title="EV Driver Identity & Wallet"
        description="Authenticate your vehicle with decentralized identity and dynamic trust on the consortium chain."
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Connected MetaMask Account:</span>
            <div style={{ marginTop: 4 }}>
              {account ? (
                <CopyChip value={account} label={`MetaMask: ${shorten(account)}`} />
              ) : (
                <button className="secondary tiny" onClick={connectInjected}>
                  🦊 Connect MetaMask
                </button>
              )}
            </div>
          </div>
          <div>
            {evEntity?.registered ? (
              <Badge kind="ok">Registered EV on Consortium</Badge>
            ) : (
              <button
                className="tiny"
                disabled={busy || !account}
                onClick={registerEvIdentity}
                title="Register your MetaMask address as an EV on the smart contract"
              >
                Register My EV Identity
              </button>
            )}
          </div>
        </div>

        <div className="field-row">
          <Field label="Driver EV DID">
            <input
              type="text"
              value={evDid}
              onChange={(e) => setEvDid(e.target.value.trim())}
              placeholder="did:ev:your-car-id"
              className="mono"
            />
          </Field>
          <Field label="DID Keccak-256 Hash">
            <input
              type="text"
              value={toDidHash(evDid)}
              readOnly
              className="mono"
              style={{ opacity: 0.75 }}
            />
          </Field>
        </div>

        {/* Dynamic Trust Score */}
        <div className="card-section">
          <div className="section-title">
            <span>Dynamic Beta-Reputation Score</span>
            <Badge kind={evEntity?.trustScoreE4 >= (minTrustScoreE4 || 3000) ? "ok" : "warn"}>
              {evEntity ? `${(evEntity.trustScoreE4 / 100).toFixed(1)}% Reputation` : "Not Registered (0.5 Prior)"}
            </Badge>
          </div>
          <TrustMeter
            scoreE4={evEntity ? evEntity.trustScoreE4 : 5000}
            thresholdE4={minTrustScoreE4 || 3000}
          />
          <div className="stats">
            <div className="stat">
              <div className="k">Total Sessions</div>
              <div className="v">{evEntity?.sessionsTotal ?? 0}</div>
            </div>
            <div className="stat">
              <div className="k">Disputed Sessions</div>
              <div className="v">{evEntity?.sessionsFailed ?? 0}</div>
            </div>
            <div className="stat">
              <div className="k">Status</div>
              <div className="v" style={{ fontSize: "0.85rem", color: "var(--ok)" }}>
                {evEntity?.registered ? "Eligible" : "Pending Reg"}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Charging Hub Selection & Session Request */}
      {!session && (
        <Card
          icon={icons.bolt}
          title="Find & Request Charging Session"
          description="Select a verified charging station and start mutual cryptographic challenge-response authentication."
        >
          <div className="field">
            <label>Select Charging Station Hub</label>
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="mono"
            >
              {DEFAULT_STATIONS.map((st) => (
                <option key={st.did} value={st.did}>
                  {st.name} — {st.did} ({st.powerKW} kW Fast Charge · ${st.ratePerKWh}/kWh)
                </option>
              ))}
            </select>
          </div>

          <div className="station-spec-box" style={{ background: "var(--surface-2)", padding: 12, borderRadius: 8, marginTop: 12, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{DEFAULT_STATIONS.find((s) => s.did === selectedStation)?.name}</strong>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>
                  Operator DID: <span className="mono">{selectedStation}</span>
                </div>
              </div>
              <Badge kind="accent">
                {stationEntity ? `${(stationEntity.trustScoreE4 / 100).toFixed(1)}% Station Trust` : "Verified Station"}
              </Badge>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 18 }}>
            <button
              onClick={initiateChargeRequest}
              disabled={busy || !account}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              {icons.bolt}
              <span>Initiate Mutual Authentication & Charge</span>
            </button>
            {!account && (
              <span style={{ fontSize: "0.8rem", color: "var(--warn)" }}>
                Connect MetaMask above to sign session challenge
              </span>
            )}
          </div>

          {status && <Message kind={status.kind}>{status.text}</Message>}

          {deniedResult && (
            <div style={{ marginTop: 16 }}>
              <Message kind="bad">
                <strong>Authorization Denied On-Chain:</strong> {deniedResult.reason}
                <div style={{ fontSize: "0.75rem", marginTop: 4 }}>TxHash: <span className="mono">{deniedResult.txHash}</span></div>
              </Message>
            </div>
          )}
        </Card>
      )}

      {/* Active In-Car Charging Dashboard */}
      {session && (
        <Card
          icon={icons.bolt}
          title="Active Charging Session"
          description={`Vehicle connected to ${session.stationDid}. Real-time energy flow monitored on-chain.`}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 20, alignItems: "center" }}>
            {/* Battery state of charge animation */}
            <div style={{ textAlign: "center", padding: 16, background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "2.4rem", fontWeight: 700, color: "var(--primary)" }}>
                {batteryPct}%
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                Battery State of Charge
              </div>
              <div style={{ width: "100%", height: 8, background: "var(--border)", borderRadius: 999, overflow: "hidden", marginTop: 10 }}>
                <div style={{ width: `${batteryPct}%`, height: "100%", background: "var(--primary)", transition: "width 0.5s ease" }} />
              </div>
            </div>

            {/* Real-time telemetry meters */}
            <div className="stats" style={{ marginTop: 0 }}>
              <div className="stat">
                <div className="k">Delivered Energy</div>
                <div className="v">{deliveredKWh} kWh</div>
              </div>
              <div className="stat">
                <div className="k">Charging Power</div>
                <div className="v">50.0 kW</div>
              </div>
              <div className="stat">
                <div className="k">Elapsed Duration</div>
                <div className="v">
                  {Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:
                  {(elapsedSeconds % 60).toString().padStart(2, "0")}
                </div>
              </div>
              <div className="stat">
                <div className="k">Estimated Cost</div>
                <div className="v">${sessionCost}</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Session ID: <span className="mono">{shorten(session.sessionId, 14, 10)}</span> · Tx: <span className="mono">{shorten(session.txHash, 10, 6)}</span>
          </div>

          <div className="actions" style={{ marginTop: 18 }}>
            <button
              onClick={() => concludeSession(true)}
              disabled={busy}
              style={{ background: "var(--ok)", borderColor: "var(--ok)" }}
            >
              Complete Charge & Settle (Succeeded)
            </button>
            <button
              className="danger"
              onClick={() => concludeSession(false)}
              disabled={busy}
            >
              Report Station Malfunction (Dispute)
            </button>
          </div>

          {status && <Message kind={status.kind}>{status.text}</Message>}
        </Card>
      )}

      {/* Completed Session Receipt */}
      {completedSession && (
        <Card
          icon={icons.lookup}
          title="Session Settlement Receipt"
          description="Charging session closed and dynamic reputation recalculated via Beta distribution."
        >
          <div className="stats">
            <div className="stat">
              <div className="k">Energy Delivered</div>
              <div className="v">{completedSession.energyKWh} kWh</div>
            </div>
            <div className="stat">
              <div className="k">Duration</div>
              <div className="v">{completedSession.durationSeconds}s</div>
            </div>
            <div className="stat">
              <div className="k">Total Cost</div>
              <div className="v">${completedSession.cost}</div>
            </div>
            <div className="stat">
              <div className="k">Outcome</div>
              <div className="v" style={{ color: completedSession.succeeded ? "var(--ok)" : "var(--bad)" }}>
                {completedSession.succeeded ? "Success (+α)" : "Disputed (+β)"}
              </div>
            </div>
          </div>

          {completedSession.ev?.proposalId && (
            <div style={{ marginTop: 14 }}>
              <Message kind="ok">
                Trust update proposal submitted to on-chain oracle quorum (Proposal #{completedSession.ev.proposalId}).
              </Message>
            </div>
          )}
        </Card>
      )}

      {/* Driver Charging History */}
      {history.length > 0 && (
        <Card
          icon={icons.log}
          title="My Charging Receipts"
          description="Recent decentralized charging sessions authenticated by this EV."
        >
          <div className="log">
            {history.map((item, idx) => (
              <div key={idx} className="log-row">
                <span className="log-time">{item.completedAt}</span>
                <span className={`badge tiny ${item.succeeded ? "ok" : "bad"}`}>
                  {item.succeeded ? "Completed" : "Disputed"}
                </span>
                <span className="log-detail">
                  {item.stationDid} · {item.energyKWh} kWh · ${item.cost}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

