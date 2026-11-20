import React, { lazy, Suspense } from "react";
import LiveChargingNetwork from "./components/LiveChargingNetwork.jsx";

const CourseApp = lazy(() => import("./CourseApp.jsx"));

export default function App() {
  if (new URLSearchParams(window.location.search).get("mode") !== "course") return <LiveChargingNetwork />;
  return <Suspense fallback={<main>Loading the private Besu workspace…</main>}><CourseApp /></Suspense>;
}
