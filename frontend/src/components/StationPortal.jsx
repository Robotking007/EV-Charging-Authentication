import React, { useState, useEffect } from "react";
import { getBytes, Contract } from "ethers";
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
  getPendingRequest,
  setPendingRequest,
  subscribeToSessionStorage,
  watchSessionDuration
} from "../utils/sharedSession.js";
import { Card, Field, Message, Badge, CopyChip, TrustMeter, shorten, icons } from "./ui.jsx";
import registryArtifact from "../abi/EVTrustRegistry.json";

export default function StationPortal() {
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

  // Station operator identity
  const [stationDid, setStationDid] = useState(() => {
    return account ? `did:station:${account.slice(2, 8).toLowerCase()}` : "did:station:001";
  });

  useEffect(() => {
    if (account) {
      setStationDid((prev) => (prev.startsWith("did:station:001") ? `did:station:${account.slice(2, 8).toLowerCase()}` : prev));
    }
  }, [account]);

  // On-chain station profile
  const [stationEntity, setStationEntity] = useState(null);

  // Inbound EV requests and active session
  const [pendingReq, setPendingReq] = useState(getPendingRequest);
  const [session, setSession] = useState(getActiveSession);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [history, setHistory] = useState(getSessionHistory);

  // Misbehavior reporting state
  const [slashTargetDid, setSlashTargetDid] = useState("did:ev:001");
  const [slashPenalty, setSlashPenalty] = useState(2000); // 20%

  // UI state
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  // Listen for shared session / request events across tabs
  useEffect(() => {
    const handleReqChange = (e) => setPendingReq(e.detail);
    const handleSessionChange = (e) => setSession(e.detail);
    const handleHistoryChange = (e) => setHistory(e.detail);

    window.addEventListener("ev_request_change", handleReqChange);
    window.addEventListener("ev_session_change", handleSessionChange);
    window.addEventListener("ev_history_change", handleHistoryChange);
    const unsubscribe = subscribeToSessionStorage({ session: setSession, history: setHistory, request: setPendingReq });
    return () => {
      unsubscribe();
      window.removeEventListener("ev_request_change", handleReqChange);
      window.removeEventListener("ev_session_change", handleSessionChange);
      window.removeEventListener("ev_history_change", handleHistoryChange);
    };
  }, []);

  // Fetch station entity on-chain
  useEffect(() => {
    let cancelled = false;
    async function loadStation() {
      const source = readOnlyContract || contract;
      if (!source) return;
      try {
        const stId = toDidHash(stationDid);
        const st = await source.entities(stId).catch(() => null);
        if (!cancelled) {
          setStationEntity(st && st.registered ? {
            registered: st.registered,
            isStation: st.isStation,
            pubKey: st.pubKey,
            trustScoreE4: Number(st.trustScoreE4),
            sessionsTotal: Number(st.sessionsTotal),
            sessionsFailed: Number(st.sessionsFailed)
          } : null);
        }
      } catch { }
    }
    loadStation();
    return () => { cancelled = true; };
  }, [stationDid, readOnlyContract, contract, session]);

  // Active session timer
  useEffect(() => watchSessionDuration(session, setElapsedSeconds), [session]);

  const deliveredKWh = session ? ((elapsedSeconds * 50) / 3600).toFixed(3) : "0.000";
  const revenue = (parseFloat(deliveredKWh) * 0.35).toFixed(2);

  // 1-Click register user's MetaMask address as a Charging Station identity
  async function registerStationIdentity() {
    if (!account) {
      connectInjected();
      return;
    }
    setBusy(true);
    setStatus({ kind: "neutral", text: "Registering your MetaMask account as a Charging Station on the consortium chain…" });
    try {
      const stId = toDidHash(stationDid);
      const res = await fetch(`${TRUST_ENGINE_URL}/register-entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ didHash: stId, pubKey: account, isStation: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");

      setStatus({ kind: "ok", text: `Successfully registered ${stationDid} linked to ${shorten(account)}!` });
      setStationEntity({
        registered: true,
        isStation: true,
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

  // Authorize incoming EV request: Station Operator signs in MetaMask or active wallet
  async function authorizeIncomingRequest() {
    if (!pendingReq) return;
    setBusy(true);
    setStatus({ kind: "neutral", text: "Connecting wallet and preparing station countersignature…" });

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
          const station = DEFAULT_STATIONS.find(({ did }) => did === pendingReq.stationDid);
          if (!station) throw new Error("Connect the wallet registered to the requested station.");
          const demoStationWallet = getDemoWallet(station.walletIndex).connect(fallbackProvider);
          activeSigner = demoStationWallet;
          activeAccount = demoStationWallet.address;
        } else {
          throw new Error("No wallet or blockchain provider available. Please connect MetaMask or start the chain.");
        }
      }

      const requestedStationDid = pendingReq.stationDid;
      const stId = toDidHash(requestedStationDid);
      if (stId !== pendingReq.stationId) throw new Error("The request contains a mismatched station DID.");
      await ensureSessionIdentity(readOnlyContract, TRUST_ENGINE_URL, stId, activeAccount, true);

      // 3. Build session digest with targetChainId (ensures signature matches contract's block.chainid)
      const digest = buildSessionDigest(
        pendingReq.evId,
        stId,
        pendingReq.nonce,
        contractAddress,
        targetChainId
      );

      // 4. Station Operator signs challenge
      setStatus({ kind: "neutral", text: "Please approve the station signature request in wallet…" });
      const stationSig = await activeSigner.signMessage(getBytes(digest));

      // 5. Submit authenticateSession to smart contract
      setStatus({ kind: "neutral", text: "Submitting mutual authentication to smart contract EVTrustRegistry.authenticateSession…" });

      let isAuthorized = false;
      let sessionId = pendingReq.nonce;
      let txHash = "";
      let submitted = false;

      try {
        const activeContract = new Contract(contractAddress, registryArtifact.abi, activeSigner);
        const tx = await activeContract.authenticateSession(
          pendingReq.evId,
          stId,
          pendingReq.nonce,
          pendingReq.evSig,
          stationSig
        );
        submitted = true;
        const receipt = await tx.wait();
        txHash = receipt.hash;
        ({ authorized: isAuthorized, sessionId } = readSessionEvent(activeContract, receipt));
      } catch (sendErr) {
        if (submitted || sendErr.code !== "INSUFFICIENT_FUNDS") throw sendErr;
      }

      // Fallback to trust-engine relayer if direct submission was unauthorized or rejected
      if (!submitted) {
        const relayRes = await fetch(`${TRUST_ENGINE_URL}/session/authenticate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evId: pendingReq.evId,
            stationId: stId,
            nonce: pendingReq.nonce,
            evSig: pendingReq.evSig,
            stationSig
          })
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
          evDid: pendingReq.evDid,
          stationDid: requestedStationDid,
          evId: pendingReq.evId,
          stationId: stId,
          stationSigner: activeAccount,
          startTime: Date.now(),
          status: "active",
          startEvScoreE4: 5000,
          startStationScoreE4: stationEntity ? stationEntity.trustScoreE4 : 5000
        };
        setElapsedSeconds(0);
        setActiveSession(newSession);
        setSession(newSession);
        setStationDid(requestedStationDid);
        setPendingRequest(null);
        setPendingReq(null);
        setStatus({ kind: "ok", text: "Mutual handshake verified on-chain! Dispenser activated." });
      } else {
        setPendingRequest(null);
        setStatus({
          kind: "bad",
          text: "Authentication verified, but session was DENIED on-chain due to EV trust score below threshold."
        });
      }
    } catch (err) {
      setStatus({ kind: "bad", text: formatErrorMessage(err, contract || readOnlyContract) });
    } finally {
      setBusy(false);
    }
  }

  // Conclude active session from station hardware
  async function concludeSession(succeeded) {
    if (!session) return;
    setBusy(true);
    setStatus({
      kind: "neutral",
      text: "Closing session & reporting certified meter reading to Trust Engine…"
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

      if (body.station?.proposalId) setLastProposalId(body.station.proposalId);

      const completed = {
        sessionId: session.sessionId,
        succeeded,
        stationDid: session.stationDid,
        evDid: session.evDid,
        energyKWh: deliveredKWh,
        durationSeconds: elapsedSeconds,
        revenue,
        completedAt: new Date().toLocaleTimeString(),
        station: body.station
      };

      addSessionHistory(completed);
      setActiveSession(null);
      setSession(null);
      setStatus({ kind: "ok", text: "Session finalized! Meter reading submitted to consortium quorum." });
    } catch (err) {
      setStatus({ kind: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Submit misbehavior slash proposal
  async function submitSlash() {
    setBusy(true);
    setStatus({ kind: "neutral", text: "Proposing on-chain slash penalty to the oracle quorum…" });
    try {
      const targetHash = toDidHash(slashTargetDid);
      const res = await fetch(`${TRUST_ENGINE_URL}/misbehavior`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ didHash: targetHash, penaltyE4: Number(slashPenalty) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Slashing request failed");

      if (data.proposalId) setLastProposalId(data.proposalId);
      setStatus({
        kind: "ok",
        text: `Slash proposal created (Proposal #${data.proposalId || "new"})! Requires M-of-N oracle approvals.`
      });
    } catch (err) {
      setStatus({ kind: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-container">
      {/* Station Operator Profile Card */}
      <Card
        icon={icons.admin}
        title="Charging Station Operator (CPO) Console"
        description="Manage charger bays, verify incoming EV handshake requests, and report verified energy delivery."
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Connected CPO MetaMask Account:</span>
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
            {stationEntity?.registered ? (
              <Badge kind="ok">Certified Consortium Station</Badge>
            ) : (
              <button
                className="tiny"
                disabled={busy || !account}
                onClick={registerStationIdentity}
                title="Register your MetaMask address as a Charging Station on the smart contract"
              >
                Register Station Identity
              </button>
            )}
          </div>
        </div>

        <div className="field-row">
          <Field label="Station DID">
            <input
              type="text"
              value={stationDid}
              onChange={(e) => setStationDid(e.target.value.trim())}
              placeholder="did:station:hub-01"
              className="mono"
            />
          </Field>
          <Field label="Station Keccak-256 Hash">
            <input
              type="text"
              value={toDidHash(stationDid)}
              readOnly
              className="mono"
              style={{ opacity: 0.75 }}
            />
          </Field>
        </div>

        {/* Dynamic Station Trust */}
        <div className="card-section">
          <div className="section-title">
            <span>Station Dynamic Reputation & Health</span>
            <Badge kind={stationEntity?.trustScoreE4 >= (minTrustScoreE4 || 3000) ? "ok" : "warn"}>
              {stationEntity ? `${(stationEntity.trustScoreE4 / 100).toFixed(1)}% Station Score` : "Default (0.5 Prior)"}
            </Badge>
          </div>
          <TrustMeter
            scoreE4={stationEntity ? stationEntity.trustScoreE4 : 5000}
            thresholdE4={minTrustScoreE4 || 3000}
          />
          <div className="stats">
            <div className="stat">
              <div className="k">Total Charged</div>
              <div className="v">{stationEntity?.sessionsTotal ?? 0} EVs</div>
            </div>
            <div className="stat">
              <div className="k">Disputed Charges</div>
              <div className="v">{stationEntity?.sessionsFailed ?? 0}</div>
            </div>
            <div className="stat">
              <div className="k">Uptime Tier</div>
              <div className="v" style={{ fontSize: "0.85rem", color: "var(--ok)" }}>
                Tier 1 (99.8%)
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Hardware Charger Bays */}
      <Card
        icon={icons.bolt}
        title="Charger Bays & Telemetry"
        description="Physical dispensers connected to the consortium smart contract."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          {/* Bay 1 */}
          <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Bay #1 — Fast DC</strong>
              <Badge kind={session ? "accent" : "ok"}>
                {session ? "⚡ Dispensing" : "Available"}
              </Badge>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
              Rating: 150 kW DC · CCS2 / NACS
            </div>
            <div style={{ marginTop: 10, fontSize: "0.75rem", fontFamily: "var(--mono)" }}>
              Voltage: 400V · Current: {session ? "125A" : "0A"}
            </div>
          </div>

          {/* Bay 2 */}
          <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Bay #2 — AC Level 2</strong>
              <Badge kind="ok">Available</Badge>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
              Rating: 22 kW AC · Type 2
            </div>
            <div style={{ marginTop: 10, fontSize: "0.75rem", fontFamily: "var(--mono)" }}>
              Voltage: 230V · Current: 0A
            </div>
          </div>
        </div>
      </Card>

      {/* Inbound EV Requests & Gatekeeper */}
      <Card
        icon={icons.session}
        title="Inbound EV Authentication Requests"
        description="Incoming EV challenge nonces requiring station countersignature and on-chain authorization."
      >
        {pendingReq ? (
          <div style={{ background: "var(--surface-2)", padding: 14, borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ fontSize: "0.95rem" }}>Incoming Request from: {pendingReq.evDid}</strong>
                <div>Requested station {pendingReq.stationDid}</div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: 4 }}>
                  Challenge Nonce: <span className="mono">{shorten(pendingReq.nonce, 12, 8)}</span>
                </div>
              </div>
              <Badge kind="warn">Pending Countersignature</Badge>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={authorizeIncomingRequest}
                disabled={busy || !account}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span>🦊 Authorize & Sign in MetaMask</span>
              </button>
              <button
                className="secondary tiny"
                onClick={() => setPendingRequest(null)}
                disabled={busy}
              >
                Reject Request
              </button>
            </div>
          </div>
        ) : (
          <div className="empty" style={{ padding: 16 }}>
            No pending EV handshake requests. When a driver clicks "Initiate Mutual Authentication" in the Customer Web, their request appears here in real time.
          </div>
        )}

        {status && <Message kind={status.kind}>{status.text}</Message>}
      </Card>

      {/* Active Session Hardware Monitor */}
      {session && (
        <Card
          icon={icons.bolt}
          title="Active Bay Dispenser Monitor"
          description={`Energy delivery active for ${session.evDid}. Certified smart meter streaming telemetry.`}
        >
          <div className="stats">
            <div className="stat">
              <div className="k">Meter Reading</div>
              <div className="v">{deliveredKWh} kWh</div>
            </div>
            <div className="stat">
              <div className="k">Flow Rate</div>
              <div className="v">50.0 kW</div>
            </div>
            <div className="stat">
              <div className="k">Duration</div>
              <div className="v">
                {Math.floor(elapsedSeconds / 60).toString().padStart(2, "0")}:
                {(elapsedSeconds % 60).toString().padStart(2, "0")}
              </div>
            </div>
            <div className="stat">
              <div className="k">Accrued Revenue</div>
              <div className="v">${revenue}</div>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 18 }}>
            <button
              onClick={() => concludeSession(true)}
              disabled={busy}
              style={{ background: "var(--ok)", borderColor: "var(--ok)" }}
            >
              Stop Dispenser & Settle Session (Report Delivered kWh)
            </button>
            <button
              className="danger"
              onClick={() => concludeSession(false)}
              disabled={busy}
            >
              Halt Dispenser on Fault / Dispute
            </button>
          </div>
        </Card>
      )}

      {/* Misbehavior / Slashing Tool */}
      <Card
        icon={icons.admin}
        title="Report Misbehavior (Direct Slash Proposal)"
        description="Report unmetered draw, fraudulent meter tampering, or key replication to trigger an on-chain penalty."
      >
        <div className="field-row">
          <Field label="Target Entity DID">
            <input
              type="text"
              value={slashTargetDid}
              onChange={(e) => setSlashTargetDid(e.target.value.trim())}
              placeholder="did:ev:suspect-01"
              className="mono"
            />
          </Field>
          <Field label="Penalty (scaled 0-10000)">
            <input
              type="number"
              min="100"
              max="10000"
              step="500"
              value={slashPenalty}
              onChange={(e) => setSlashPenalty(Number(e.target.value))}
            />
          </Field>
        </div>
        <button className="danger" onClick={submitSlash} disabled={busy}>
          Propose Direct Slash Penalty
        </button>
      </Card>

      {/* Station History */}
      {history.length > 0 && (
        <Card
          icon={icons.log}
          title="Station Dispenser History"
          description="Log of recent charging sessions serviced by this station."
        >
          <div className="log">
            {history.map((item, idx) => (
              <div key={idx} className="log-row">
                <span className="log-time">{item.completedAt}</span>
                <span className={`badge tiny ${item.succeeded ? "ok" : "bad"}`}>
                  {item.succeeded ? "Normal Settle" : "Disputed"}
                </span>
                <span className="log-detail">
                  {item.evDid} · {item.energyKWh} kWh · Revenue ${item.revenue || item.cost}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

