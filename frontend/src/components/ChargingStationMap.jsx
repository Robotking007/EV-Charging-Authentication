import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function markerStyle(station, active) {
  return {
    radius: active ? 9 : 5,
    color: active ? "#ffffff" : "#14232e",
    weight: active ? 3 : 1.5,
    fillColor: active ? "#0f766e" : station.operational ? "#14b8a6" : "#64748b",
    fillOpacity: active ? 1 : 0.86
  };
}

export default function ChargingStationMap({ stations, selected, onSelect }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef(new Map());
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    const map = L.map(container.current, { scrollWheelZoom: false }).setView([20, 78], 4);
    mapRef.current = map;
    map.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).on("tileerror", () => setTileError(true))
      .addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);
    const byId = new Map();
    const points = [];
    for (const station of stations) {
      const { latitude, longitude } = station;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
      const location = [latitude, longitude];
      const marker = L.circleMarker(location, markerStyle(station, false)).addTo(layer);
      const label = document.createElement("span");
      label.textContent = station.name;
      marker.bindTooltip(label).on("click", () => onSelect(station.id));
      byId.set(station.id, { marker, station });
      points.push(location);
    }
    markers.current = byId;
    if (points.length) {
      map.fitBounds(points, { padding: [28, 28], maxZoom: 13, animate: false });
    }
    return () => layer.remove();
  }, [stations, onSelect]);

  useEffect(() => {
    for (const [id, { marker, station }] of markers.current) {
      const active = id === selected;
      marker.setStyle(markerStyle(station, active));
      if (active) {
        marker.bringToFront();
        mapRef.current.panInside(marker.getLatLng(), { padding: [30, 30], animate: false });
      }
    }
  }, [selected, stations]);

  return (
    <section className="network-map-card" aria-label="Charging station map">
      <div ref={container} className="network-map" aria-label="Map of matching stations" />
      <div className="network-map-legend">
        {tileError && <span>Some map tiles are unavailable.</span>}
        <span><i className="network-map-dot is-operational" />Reported operational</span>
        <span><i className="network-map-dot" />Other or unknown status</span>
      </div>
    </section>
  );
}
