import React, { useState, useEffect } from "react";
import { Web3Provider, useWeb3 } from "./Web3Context.jsx";
import NavBar from "./components/NavBar.jsx";
import CustomerPortal from "./components/CustomerPortal.jsx";
import StationPortal from "./components/StationPortal.jsx";
import ConsortiumPortal from "./components/ConsortiumPortal.jsx";
import SessionSimulator from "./components/SessionSimulator.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import OraclePanel from "./components/OraclePanel.jsx";
import EntityLookup from "./components/EntityLookup.jsx";
import EventLog from "./components/EventLog.jsx";
import StatusStrip from "./components/StatusStrip.jsx";
import SetupBanner from "./components/SetupBanner.jsx";
import LoginModal from "./components/LoginModal.jsx";
import PaidSessionPanel from "./components/PaidSessionPanel.jsx";

function Footer() {
  const { deployment } = useWeb3();
  return (
    <footer className="app-footer">
      <span>Permissioned consortium ledger · Beta-reputation trust engine with exponential time decay</span>
      {deployment?.deployedAt && (
        <span>Contract deployed {new Date(deployment.deployedAt).toLocaleString()}</span>
      )}
    </footer>
  );
}

function MainContent() {
  const { deployment } = useWeb3();
  const course = deployment.mode === "course";
  const getTabFromHash = () => {
    const hash = window.location.hash.replace("#", "").toLowerCase();
    if (course) {
      if (hash === "customer" || hash === "station") return hash;
      return ["consortium", "admin"].includes(hash) ? "consortium" : "settlement";
    }
    if (hash === "station") return "station";
    if (hash === "consortium" || hash === "admin") return "consortium";
    if (hash === "simulator") return "simulator";
    return "customer";
  };

  const [activeTab, setActiveTabState] = useState(getTabFromHash);

  const setActiveTab = (tab) => {
    window.location.hash = tab;
    setActiveTabState(tab);
  };

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTabState(getTabFromHash());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const showPaidSession = course && ["settlement", "customer", "station"].includes(activeTab);

  return (
    <>
      <NavBar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main style={{ minHeight: "65vh" }}>
        {showPaidSession && (
          <div className="simulator-view">
            <StatusStrip />
            <SetupBanner />
            <PaidSessionPanel role={activeTab} />
          </div>
        )}
        {!course && activeTab === "customer" && <CustomerPortal />}
        {!course && activeTab === "station" && <StationPortal />}
        {activeTab === "consortium" && <ConsortiumPortal />}
        {activeTab === "simulator" && (
          <div className="simulator-view">
            <StatusStrip />
            <SetupBanner />
            <div className="grid">
              <div className="stack">
                <SessionSimulator />
                <AdminPanel />
              </div>
              <div className="stack">
                <EntityLookup />
                <OraclePanel />
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <EventLog />
            </div>
          </div>
        )}
      </main>

      <LoginModal />
      <Footer />
    </>
  );
}

export default function CourseApp() {
  return (
    <Web3Provider>
      <MainContent />
    </Web3Provider>
  );
}
