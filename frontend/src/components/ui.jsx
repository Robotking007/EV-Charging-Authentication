import React, { useState } from "react";

export function Card({ icon, title, description, children, footer }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          {icon && <span className="card-icon">{icon}</span>}
          {title}
        </h2>
        {description && <p>{description}</p>}
      </div>
      <div className="card-body">{children}</div>
      {footer}
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Message({ kind, children }) {
  if (!children) return null;
  return (
    <div className={`message ${kind || "neutral"}`}>
      <div className="msg-body">{children}</div>
    </div>
  );
}

export function Badge({ kind, children }) {
  return <span className={`badge ${kind || "neutral"}`}>{children}</span>;
}

export function shorten(value, lead = 10, tail = 6) {
  if (!value) return "";
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export function CopyChip({ value, label }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="chip" title={value}>
      <span>{label || shorten(value)}</span>
      <button className="ghost tiny" onClick={copy}>{copied ? "copied" : "copy"}</button>
    </span>
  );
}

/** Trust score meter with the authorization threshold marked on the track. */
export function TrustMeter({ scoreE4, thresholdE4 }) {
  const pct = Math.max(0, Math.min(100, scoreE4 / 100));
  const passing = thresholdE4 == null || scoreE4 >= thresholdE4;
  return (
    <div className="meter-wrap">
      <div className="meter-top">
        <span className="meter-value">{pct.toFixed(2)}%</span>
        <span className="meter-label">
          {thresholdE4 != null && `threshold ${(thresholdE4 / 100).toFixed(0)}%`}
        </span>
      </div>
      <div className="meter">
        <div className={`meter-fill ${passing ? "ok" : "bad"}`} style={{ width: `${pct}%` }} />
        {thresholdE4 != null && (
          <div className="meter-threshold" style={{ left: `calc(${thresholdE4 / 100}% - 1px)` }} />
        )}
      </div>
      <div className="meter-legend">
        <span>0%</span>
        <span>{passing ? "above authorization threshold" : "below threshold — sessions denied"}</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export const icons = {
  admin: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 6v6c0 5 3.4 9 8 10 4.6-1 8-5 8-10V6z" />
    </svg>
  ),
  oracle: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" />
      <path d="M7 7.5 10.5 10M17 7.5 13.5 10M12 15v5" />
    </svg>
  ),
  session: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  lookup: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  ),
  log: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  bolt: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  )
};
