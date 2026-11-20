import React from "react";
import StatusStrip from "./StatusStrip.jsx";
import SetupBanner from "./SetupBanner.jsx";
import AdminPanel from "./AdminPanel.jsx";
import OraclePanel from "./OraclePanel.jsx";
import EntityLookup from "./EntityLookup.jsx";
import EventLog from "./EventLog.jsx";

export default function ConsortiumPortal() {
  return (
    <div className="consortium-portal">
      <StatusStrip />
      <SetupBanner />

      <div className="grid">
        <div className="stack">
          <AdminPanel />
          <EntityLookup />
        </div>
        <div className="stack">
          <OraclePanel />
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <EventLog />
      </div>
    </div>
  );
}

