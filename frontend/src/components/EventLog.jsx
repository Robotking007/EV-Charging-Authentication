import React, { useEffect, useState } from "react";
import { TRUST_ENGINE_URL, useWeb3 } from "../Web3Context.jsx";
import { Card, Badge, icons, shorten } from "./ui.jsx";

const EVENT_STYLE = {
  Registered: "neutral",
  IdentityKeyChanged: "accent",
  IdentityRevoked: "bad",
  SessionAuthenticated: "ok",
  SessionDenied: "bad",
  ProposalCreated: "accent",
  ProposalApproved: "accent",
  TrustScoreUpdated: "ok",
  SessionFunded: "accent",
  SessionSettled: "ok",
  SessionRefunded: "neutral",
  Slashed: "bad"
};

const WATCHED = Object.keys(EVENT_STYLE);

export default function EventLog() {
  const { readOnlyContract, deployment } = useWeb3();
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!readOnlyContract) return;

    let cancelled = false;
    setEntries([]);
    setError("");
    function merge(logs) {
      if (cancelled || !logs.length) return;
      const next = logs.map((log) => {
        const detail = Object.values(log.args)
          .map((a) => {
            if (typeof a === "bigint") return a.toString();
            if (typeof a === "string" && a.startsWith("0x") && a.length > 20) return shorten(a, 10, 4);
            return String(a);
          })
          .join("  ");
        return {
          key: `${log.transactionHash}:${log.logIndex ?? log.index}`,
          name: log.name ?? log.eventName, detail, block: log.blockNumber, index: log.logIndex ?? log.index
        };
      });
      setEntries((previous) => [...new Map([...next, ...previous].map((entry) => [entry.key, entry])).values()]
        .sort((a, b) => b.block - a.block || b.index - a.index)
        .slice(0, 100));
    }

    async function load() {
      if (cancelled) return;
      const filter = [WATCHED.filter((name) => readOnlyContract.interface.hasEvent(name))];
      const head = await readOnlyContract.runner.getBlockNumber();
      try {
        const response = await fetch(`${TRUST_ENGINE_URL}/records/events?limit=100`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) {
          const body = await response.json();
          const address = (await readOnlyContract.getAddress()).toLowerCase();
          if (body.registry?.toLowerCase() === address && body.indexedThrough >= head - 6) {
            merge(body.records);
            if (cursor === null) cursor = body.indexedThrough;
          }
        }
      } catch {
        // Read the current ledger directly if its database index is unavailable.
      }
      const first = deployment.blockNumber ?? head;
      if (cursor === null) {
        let loaded = 0;
        // Load recent history backwards in pages before polling for new blocks.
        for (let end = head; end >= first && loaded < 100 && !cancelled; end -= 500) {
          const logs = await readOnlyContract.queryFilter(filter, Math.max(first, end - 499), end);
          merge(logs);
          loaded += logs.length;
        }
        cursor = head;
      } else if (head > cursor) {
        const end = Math.min(head, cursor + 500);
        merge(await readOnlyContract.queryFilter(filter, cursor + 1, end));
        cursor = end;
      }
      if (!cancelled) setError("");
    }

    let cursor = null;
    let timer;
    async function poll() {
      try {
        await load();
      } catch {
        if (!cancelled) setError("Could not load ledger activity.");
      } finally {
        if (!cancelled) timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [readOnlyContract, deployment.blockNumber]);

  return (
    <Card
      icon={icons.log}
      title="Ledger activity"
      description="Recent registration, authentication, settlement and trust events from the ledger."
    >
      <div className="log">
        {entries.length === 0 ? (
          <div className="empty">{error || "No events yet. Run a session or register an entity to see activity here."}</div>
        ) : (
          entries.map((e) => (
            <div className="log-row" key={e.key}>
              <span className="log-time">Block {e.block}</span>
              <Badge kind={EVENT_STYLE[e.name]}>{e.name}</Badge>
              <span className="log-detail">{e.detail}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
