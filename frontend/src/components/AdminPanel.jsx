import React, { useState } from "react";
import { useWeb3 } from "../Web3Context.jsx";
import { toDidHash } from "../utils/didHash.js";
import { Card, Field, Message, icons } from "./ui.jsx";

import { formatErrorMessage } from "../utils/formatError.js";

export default function AdminPanel() {
  const { contract, minTrustScoreE4, requiredApprovals } = useWeb3();
  const [didInput, setDidInput] = useState("did:ev:001");
  const [pubKey, setPubKey] = useState("");
  const [isStation, setIsStation] = useState(false);
  const [minScore, setMinScore] = useState("3000");
  const [approvals, setApprovals] = useState("2");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(label, fn) {
    setBusy(true);
    setStatus({ kind: "neutral", text: `${label}…` });
    try {
      const tx = await fn();
      await tx.wait();
      setStatus({ kind: "ok", text: `${label} confirmed in block.` });
    } catch (err) {
      setStatus({ kind: "bad", text: formatErrorMessage(err, contract) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      icon={icons.admin}
      title="Admin console"
      description="Issue DID-anchored identities and set consortium policy. Requires REGISTRAR_ROLE or DEFAULT_ADMIN_ROLE."
    >
      <div className="section-title">Register identity</div>
      <div className="field-row">
        <Field label="Entity DID">
          <input type="text" value={didInput} onChange={(e) => setDidInput(e.target.value)} placeholder="did:ev:001" />
        </Field>
        <Field label="Signing address (on-chain public key)">
          <input className="mono" type="text" value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="0x…" />
        </Field>
      </div>
      <div className="actions between">
        <label className="checkbox">
          <input type="checkbox" checked={isStation} onChange={(e) => setIsStation(e.target.checked)} />
          Charging station {isStation ? "" : "(unchecked = electric vehicle)"}
        </label>
        <button
          disabled={!contract || busy || !didInput || !pubKey}
          onClick={() => run("Registration", () => contract.register(toDidHash(didInput), pubKey.trim(), isStation))}
        >
          Register entity
        </button>
      </div>
      <div className="actions">
        <button type="button" className="secondary" disabled={!contract || busy || !didInput || !pubKey}
          onClick={() => run("Key rotation", () => contract.rotateIdentityKey(toDidHash(didInput), pubKey.trim()))}>
          Rotate signing key
        </button>
        <button type="button" className="secondary" disabled={!contract || busy || !didInput}
          onClick={() => {
            if (window.confirm(`Permanently revoke ${didInput}?`)) run("Revocation", () => contract.revokeIdentity(toDidHash(didInput)));
          }}>
          Revoke identity
        </button>
      </div>

      <div className="card-section">
        <div className="section-title">Consortium policy</div>
        <div className="field-row">
          <Field label={`Authorization threshold${minTrustScoreE4 != null ? ` (now ${minTrustScoreE4})` : ""}`}>
            <input type="number" min="0" max="10000" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </Field>
          <Field label={`Required oracle approvals${requiredApprovals != null ? ` (now ${requiredApprovals})` : ""}`}>
            <input type="number" min="1" value={approvals} onChange={(e) => setApprovals(e.target.value)} />
          </Field>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={!contract || busy}
            onClick={() => run("Threshold update", () => contract.setMinTrustScore(Number(minScore)))}
          >
            Set threshold
          </button>
          <button
            className="secondary"
            disabled={!contract || busy}
            onClick={() => run("Approval quorum update", () => contract.setRequiredApprovals(Number(approvals)))}
          >
            Set quorum
          </button>
        </div>
      </div>

      {status && <Message kind={status.kind}>{status.text}</Message>}
    </Card>
  );
}
