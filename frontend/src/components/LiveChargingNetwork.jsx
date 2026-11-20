import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Badge, Message } from "./ui.jsx";
import ChargingStationMap from "./ChargingStationMap.jsx";
import "./LiveChargingNetwork.css";

const PAGE_SIZE = 18;
const API = import.meta.env.VITE_TRUST_ENGINE_URL || "/api/trust-engine";
const countryNames = new Intl.DisplayNames(undefined, { type: "region", fallback: "code" });

function attributionLink(license) {
  if (typeof license !== "string") return null;
  try {
    const url = new URL(license);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function LiveChargingNetwork() {
  const [countryInput, setCountryInput] = useState("IN");
  const [country, setCountry] = useState("IN");
  const [directory, setDirectory] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [operationalOnly, setOperationalOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const stationDetails = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ country });
    setError("");
    setDirectory(null);

    async function load() {
      try {
        const response = await fetch(API + "/directory/stations?" + params, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load the station directory.");
        if (!controller.signal.aborted) setDirectory(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message);
      }
    }

    load();
    return () => controller.abort();
  }, [country]);

  const query = search.trim().toLocaleLowerCase();
  const stations = useMemo(() => (directory?.stations || []).filter((station) => (
    (!operationalOnly || station.operational) &&
    [station.name, station.address, station.operator].filter(Boolean).join(" ").toLocaleLowerCase().includes(query)
  )), [directory, operationalOnly, query]);
  const selection = stations.find((station) => station.id === selected);
  const sourceLicense = attributionLink(selection?.dataLicense);

  return (
    <div className="network-screen">
      <header className="app-header">
        <nav className="actions" aria-label="Charging links">
          <a href="/?mode=course">Private Besu workspace</a>
        </nav>
      </header>
      <main className="network-content">
        <div className="network-title">
          <h1>Find a charging station</h1>
          <a href="https://openchargemap.org/" target="_blank" rel="noreferrer">Data from Open Charge Map ↗</a>
        </div>
        {error && <Message kind="warn">{error}</Message>}
        {directory?.stale && <Message kind="warn">Open Charge Map is temporarily unavailable. Showing the last saved results.</Message>}
        <section className="network-controls" aria-label="Station filters">
          <label>Search by station, operator or address<input type="text" value={search} onChange={(event) => {
            setSearch(event.target.value);
            setLimit(PAGE_SIZE);
          }} /></label>
          <form className="network-country" onSubmit={(event) => {
            event.preventDefault();
            setCountry(countryInput.trim().toUpperCase());
            setSelected(null);
            setLimit(PAGE_SIZE);
          }}>
            <label>Country code<input type="text" value={countryInput} required pattern="[A-Za-z]{2}" maxLength={2}
              onChange={(event) => setCountryInput(event.target.value.toUpperCase())} /></label>
            <button className="secondary" type="submit">Load country</button>
          </form>
          <label className="checkbox"><input type="checkbox" checked={operationalOnly} onChange={(event) => {
            setOperationalOnly(event.target.checked);
            setLimit(PAGE_SIZE);
          }} />Reported operational</label>
        </section>
        <div className="network-results">
          <div className="network-explorer">
            <ChargingStationMap stations={stations} selected={selected} onSelect={setSelected} />
            {selection && <div ref={stationDetails} className="network-station-details">
              <Card title={selection.name} description={selection.address}>
                  <div className="actions">
                    <Badge kind={selection.operational ? "ok" : "neutral"}>{selection.status}</Badge>
                    {selection.access && <Badge kind="neutral">{selection.access}</Badge>}
                  </div>
                  <div className="actions">
                    <a href={"https://openchargemap.org/site/poi/details/" + selection.id} target="_blank" rel="noreferrer">View on Open Charge Map ↗</a>
                    <button className="secondary tiny" onClick={() => setSelected(null)}>Close connector details</button>
                  </div>
                  {selection.connectors.length ? <ul className="network-connectors">{selection.connectors.map((connector, index) => (
                    <li key={connector.id ?? index}>
                      <span>{connector.type}{Number.isFinite(connector.powerKW) && " · " + connector.powerKW + " kW"}</span>
                      {connector.quantity > 0 && <Badge kind="neutral">{connector.quantity} reported</Badge>}
                    </li>
                  ))}</ul> : <p>No connector details reported.</p>}
                  {selection.cost && <p>Reported price {selection.cost}</p>}
                  {selection.lastVerified && Number.isFinite(Date.parse(selection.lastVerified)) && <p>Listing verified {new Date(selection.lastVerified).toLocaleDateString()}</p>}
                  <p>Data provider {selection.dataProvider}{sourceLicense
                    ? <> · <a href={sourceLicense} target="_blank" rel="noreferrer">Data license ↗</a></>
                    : selection.dataLicense && " · " + selection.dataLicense}</p>
              </Card>
            </div>}
          </div>
          <section className="network-list" aria-label="Charging station listings">
              <h2 aria-live="polite">{directory ? stations.length + " stations in " + countryNames.of(country)
                : !error ? "Loading stations for " + countryNames.of(country) + "…" : "Station listings"}</h2>
              {directory?.stations.length >= directory?.limit && <p className="network-limit">Showing up to {directory.limit} Open Charge Map listings for this country.</p>}
            {directory && !stations.length && <p className="empty">No stations match your search.</p>}
            <div className="network-stations">
              {stations.slice(0, limit).map((station) => (
                <Card key={station.id} title={station.name} description={station.address}>
                  <div className="actions">
                    <Badge kind={station.operational ? "ok" : "neutral"}>{station.status}</Badge>
                    {station.access && <Badge kind="neutral">{station.access}</Badge>}
                  </div>
                  {station.operator && <p>{station.operator}</p>}
                  <div className="actions">
                    <button className="secondary tiny" aria-pressed={selected === station.id} onClick={() => {
                      setSelected(station.id);
                      requestAnimationFrame(() => stationDetails.current?.scrollIntoView({ block: "nearest" }));
                    }}>View connectors</button>
                    {Number.isFinite(station.latitude) && Number.isFinite(station.longitude) && (
                      <a href={"https://www.google.com/maps/dir/?api=1&destination=" + station.latitude + "," + station.longitude}
                        target="_blank" rel="noreferrer">Directions ↗</a>
                    )}
                  </div>
                </Card>
              ))}
            </div>
            {stations.length > limit && <button className="secondary" onClick={() => setLimit(limit + PAGE_SIZE)}>Show more stations</button>}
          </section>
        </div>
      </main>
      <footer className="app-footer">
        <span>Station status is reported by the data provider. Live connector availability may differ.</span>
        <a href="https://openchargemap.org/" target="_blank" rel="noreferrer">Open Charge Map ↗</a>
      </footer>
    </div>
  );
}
