import React, { useState, useEffect } from "react";
import { useWeb3 } from "../Web3Context.jsx";
import { toDidHash } from "../utils/didHash.js";
import { Card, Field, Message, Badge, CopyChip, icons } from "./ui.jsx";

import { formatErrorMessage } from "../utils/formatError.js";

const ACTION_LABELS = ["Score update", "Slash"];

export default function OraclePanel() {
  const { contract, readOnlyContract, requiredApprovals, lastProposalId, setLastProposalId } = useWeb3();
  const [didInput, setDidInput] = useState("did:station:001");
  const [newScore, setNewScore] = useState("7000");
  const [sessionOk, setSessionOk] = useState(true);
  const [penalty, setPenalty] = useState("2000");
  const [proposalId, setProposalId] = useState("");
  const [proposal, setProposal] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  // The session simulator publishes the proposal the trust engine just
  // created, so the operator can approve it here without copying by hand.
  useEffect(() => {
    if (lastProposalId) setProposalId(lastProposalId);
  }, [lastProposalId]);

  async function submit(label, send) {
    setBusy(true);
    setStatus({ kind: "neutral", text: `${label}…` });
    try {
      const tx = await send();
      const receipt = await tx.wait();
      const address = (await contract.getAddress()).toLowerCase();
      const created = receipt.logs
        .filter((log) => log.address.toLowerCase() === address)
        .map((log) => contract.interface.parseLog(log))
        .find((event) => event?.name === "ProposalCreated");
      if (!created) throw new Error("The registry did not emit a proposal ID.");
      const id = created.args.proposalId;
      setProposalId(id);
      setLastProposalId(id);
      setStatus({ kind: "ok", text: `${label} submitted. Awaiting quorum.` });
      await refresh(id);
    } catch (err) {
      setStatus({ kind: "bad", text: formatErrorMessage(err, contract) });
    } finally {
      setBusy(false);
    }
  }

  async function refresh(id = proposalId) {
    const source = readOnlyContract || contract;
    if (!source || !id) return;
    try {
      const p = await source.proposals(id);
      setProposal({
        action: ACTION_LABELS[Number(p.actionType)],
        didHash: p.didHash,
        valueE4: p.valueE4.toString(),
        approvals: Number(p.approvalCount),
        executed: p.executed
      });
    } catch (err) {
      setStatus({ kind: "bad", text: err.shortMessage || err.message });
    }
  }

  return (
    <Card
      icon={icons.oracle}
      title="Oracle console"
      description="Trust changes need approval from multiple independent oracles before they take effect on-chain."
    >
      <div className="section-title">Propose a trust change</div>
      <div className="field-row">
        <Field label="Entity DID">
          <input type="text" value={didInput} onChange={(e) => setDidInput(e.target.value)} placeholder="did:station:001" />
        </Field>
        <Field label="New trust score (0–10000)">
          <input type="number" min="0" max="10000" value={newScore} onChange={(e) => setNewScore(e.target.value)} />
        </Field>
        <Field label="Slash penalty (0–10000)">
          <input type="number" min="1" max="10000" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
        </Field>
      </div>

      <div className="actions between">
        <label className="checkbox">
          <input type="checkbox" checked={sessionOk} onChange={(e) => setSessionOk(e.target.checked)} />
          Session succeeded
        </label>
        <div className="actions" style={{ margin: 0 }}>
          <button
            disabled={!contract || busy || !didInput}
            onClick={() => submit(
              "Score update",
              () => contract.proposeScoreUpdate(toDidHash(didInput), Number(newScore), sessionOk)
            )}
          >
            Propose score
          </button>
          <button
            className="danger"
            disabled={!contract || busy || !didInput}
            onClick={() => submit(
              "Slash",
              () => contract.proposeSlash(toDidHash(didInput), Number(penalty))
            )}
          >
            Propose slash
          </button>
        </div>
      </div>

      <div className="card-section">
        <div className="section-title">Approve a pending proposal</div>
        <Field label="Proposal ID">
          <input className="mono" type="text" value={proposalId} onChange={(e) => setProposalId(e.target.value)} placeholder="0x…" />
        </Field>
        <div className="actions">
          <button
            disabled={!contract || busy || !proposalId}
            onClick={() => {
              setBusy(true);
              setStatus({ kind: "neutral", text: "Submitting approval…" });
              contract.approveProposal(proposalId)
                .then((tx) => tx.wait())
                .then(() => { setStatus({ kind: "ok", text: "Approval recorded." }); return refresh(); })
                .catch((err) => setStatus({ kind: "bad", text: err.shortMessage || err.message }))
                .finally(() => setBusy(false));
            }}
          >
            Approve as connected account
          </button>
          <button className="secondary" disabled={!proposalId} onClick={() => refresh()}>Refresh</button>
          {proposalId && <CopyChip value={proposalId} />}
        </div>

        {proposal && (
          <div className="stats">
            <div className="stat">
              <div className="k">Action</div>
              <div className="v" style={{ fontSize: "0.9rem" }}>{proposal.action}</div>
            </div>
            <div className="stat">
              <div className="k">Value</div>
              <div className="v">{proposal.valueE4}</div>
            </div>
            <div className="stat">
              <div className="k">Approvals</div>
              <div className="v">{proposal.approvals}{requiredApprovals ? ` / ${requiredApprovals}` : ""}</div>
            </div>
            <div className="stat">
              <div className="k">State</div>
              <div className="v" style={{ fontSize: "0.9rem" }}>
                <Badge kind={proposal.executed ? "ok" : "warn"}>
                  {proposal.executed ? "Executed" : "Pending"}
                </Badge>
              </div>
            </div>
          </div>
        )}
      </div>

      {status && <Message kind={status.kind}>{status.text}</Message>}
    </Card>
  );
}
