// Shared session management for EV Customer and Charging Station portals.
// Synchronizes active charging sessions, requests, and history between tabs/windows via localStorage and custom events.

const STORAGE_KEY_SESSION = "ev_trust_active_session";
const STORAGE_KEY_HISTORY = "ev_trust_session_history";
const STORAGE_KEY_REQUEST = "ev_trust_pending_request";

export const DEFAULT_STATIONS = [
  {
    did: "did:station:001",
    name: "Downtown Consortium Superhub",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    walletIndex: 1,
    powerKW: 150,
    plugType: "CCS2 / NACS DC Fast",
    ratePerKWh: 0.35,
    status: "Available"
  },
  {
    did: "did:station:002",
    name: "Metro GreenCharge Bay 4",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    walletIndex: 2,
    powerKW: 50,
    plugType: "CCS2 DC",
    ratePerKWh: 0.28,
    status: "Available"
  },
  {
    did: "did:station:003",
    name: "Highway VoltExpress Plaza",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    walletIndex: 3,
    powerKW: 250,
    plugType: "Ultra-Fast DC",
    ratePerKWh: 0.42,
    status: "Available"
  }
];

export const DEFAULT_EVS = [
  {
    did: "did:ev:001",
    name: "Tesla Model 3 (Fleet #01)",
    walletIndex: 0,
    batteryKWh: 75,
    currentSOC: 28
  },
  {
    did: "did:ev:002",
    name: "Hyundai Ioniq 5 (Fleet #02)",
    walletIndex: 4,
    batteryKWh: 77.4,
    currentSOC: 35
  },
  {
    did: "did:ev:003",
    name: "Porsche Taycan (Fleet #03)",
    walletIndex: 5,
    batteryKWh: 93.4,
    currentSOC: 22
  }
];

export function getActiveSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setActiveSession(session) {
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
    window.dispatchEvent(new CustomEvent("ev_session_change", { detail: session }));
  } catch {}
}

export function getSessionHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addSessionHistory(item) {
  try {
    const history = getSessionHistory();
    const updated = [item, ...history.filter((entry) => entry.sessionId !== item.sessionId)].slice(0, 30);
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("ev_history_change", { detail: updated }));
  } catch {}
}

export function subscribeToSessionStorage({ session, history, request }) {
  function handleStorage(event) {
    if (event.storageArea !== localStorage) return;
    if (event.key === STORAGE_KEY_SESSION || event.key === null) session?.(getActiveSession());
    if (event.key === STORAGE_KEY_HISTORY || event.key === null) history?.(getSessionHistory());
    if (event.key === STORAGE_KEY_REQUEST || event.key === null) request?.(getPendingRequest());
  }
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

export function watchSessionDuration(session, onTick) {
  if (session?.status !== "active") {
    onTick(0);
    return;
  }
  const tick = () => onTick(Math.max(0, Math.floor((Date.now() - session.startTime) / 1000)));
  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

export function getPendingRequest() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REQUEST);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setPendingRequest(req) {
  try {
    if (req) {
      localStorage.setItem(STORAGE_KEY_REQUEST, JSON.stringify(req));
    } else {
      localStorage.removeItem(STORAGE_KEY_REQUEST);
    }
    window.dispatchEvent(new CustomEvent("ev_request_change", { detail: req }));
  } catch {}
}

