import React, { useState } from "react";
import { useWeb3 } from "../Web3Context.jsx";
import { toDidHash } from "../utils/didHash.js";
import { Card, Field, Message, Badge, CopyChip, TrustMeter, icons } from "./ui.jsx";

export default function EntityLookup() {
  const { readOnlyContract, minTrustScoreE4 } = useWeb3();
  const [didInput, setDidInput] = useState("did:ev:001");
  const [entity, setEntity] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setBusy(true);
    setStatus(null);
    setEntity(null);
    try {
      const didHash = toDidHash(didInput);
      const [e, revoked] = await Promise.all([
        readOnlyContract.entities(didHash),
        readOnlyContract.revoked(didHash)
      ]);
      if (!e.registered) {
        setStatus({ kind: "warn", text: "No entity is registered under that DID." });
        return;
      }
      setEntity({
        isStation: e.isStation,
        revoked,
        pubKey: e.pubKey,
        trustScoreE4: Number(e.trustScoreE4),
        sessionsTotal: e.sessionsTotal.toString(),
        sessionsFailed: e.sessionsFailed.toString(),
        lastUpdated: new Date(Number(e.lastUpdated) * 1000).toLocaleString()
      });
    } catch (err) {
      setStatus({ kind: "bad", text: err.shortMessage || err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      icon={icons.lookup}
      title="Entity trust profile"
      description="Live reputation for any registered vehicle or charging station. Available without a wallet."
    >
      <div className="field-row">
        <Field label="Entity DID">
          <input
            type="text"
            value={didInput}
            onChange={(e) => setDidInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="did:ev:001"
          />
        </Field>
      </div>
      <div className="actions">
        <button disabled={!readOnlyContract || busy || !didInput} onClick={lookup}>Look up</button>
      </div>

      {entity && (
        <>
          <div className="actions">
            <Badge kind="neutral">{entity.isStation ? "Charging station" : "Electric vehicle"}</Badge>
            <Badge kind={!entity.revoked && minTrustScoreE4 != null && entity.trustScoreE4 >= minTrustScoreE4 ? "ok" : "bad"}>
              {entity.revoked ? "Revoked" : minTrustScoreE4 != null && entity.trustScoreE4 >= minTrustScoreE4 ? "Eligible to charge" : "Below threshold"}
            </Badge>
            <CopyChip value={entity.pubKey} />
          </div>

          <TrustMeter scoreE4={entity.trustScoreE4} thresholdE4={minTrustScoreE4} />

          <div className="stats">
            <div className="stat">
              <div className="k">Sessions</div>
              <div className="v">{entity.sessionsTotal}</div>
            </div>
            <div className="stat">
              <div className="k">Failed</div>
              <div className="v">{entity.sessionsFailed}</div>
            </div>
            <div className="stat">
              <div className="k">Score (e4)</div>
              <div className="v">{entity.trustScoreE4}</div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: "0.75rem", color: "var(--text-faint)" }}>
            Last updated {entity.lastUpdated}
          </div>
        </>
      )}

      {!entity && !status && (
        <div className="empty">Look up a DID to see its live trust score.</div>
      )}

      {status && <Message kind={status.kind}>{status.text}</Message>}
    </Card>
  );
}
