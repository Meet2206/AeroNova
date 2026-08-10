import React, { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSimulation } from "../../simulation/SimulationProvider";

export const TacticalMap: React.FC = () => {
  const { telemetry, activeDetection, gpsFlashActive } = useSimulation();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const droneElRef = useRef<HTMLDivElement | null>(null);
  const droneMarkerRef = useRef<maplibregl.Marker | null>(null);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [autoCenter, setAutoCenter] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [trail, setTrail] = useState<[number, number][]>([]);

  const isStale = telemetry.provenance === "STALE";
  const hasGps = telemetry.system.gps_fix !== "NO_FIX";
  const { lat, lng, heading } = telemetry.location;
  const ms = telemetry.mission_state;

  // Trail breadcrumbs
  useEffect(() => {
    if (isStale || !hasGps) return;
    setTrail(prev => {
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        if (Math.abs(last[0] - lng) < 0.000001 && Math.abs(last[1] - lat) < 0.000001) return prev;
      }
      const next: [number, number][] = [...prev, [lng, lat]];
      return next.slice(-250);
    });
  }, [lat, lng, isStale, hasGps]);

  // Clear trail on mission reset
  useEffect(() => {
    if (ms === "SEARCHING") setTrail([]);
  }, [ms]);

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [lng, lat],
        zoom: 15.5,
        pitch: 25,
        bearing: 0,
        attributionControl: false,
      });

      map.on("load", () => {
        // Trail line
        map.addSource("trail", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
        });
        map.addLayer({
          id: "trail-layer", type: "line", source: "trail",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#10B981", "line-width": 1.5, "line-opacity": 0.5, "line-dasharray": [2, 3] },
        });

        // Vector line (drone→target)
        map.addSource("vector", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
        });
        map.addLayer({
          id: "vector-layer", type: "line", source: "vector",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#DC2626", "line-width": 1, "line-opacity": 0.65, "line-dasharray": [1, 3] },
        });

        // Search radius circle
        map.addSource("search-radius", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} },
        });
        map.addLayer({
          id: "search-radius-layer", type: "circle", source: "search-radius",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 40, 15, 120, 17, 220] as any,
            "circle-color": "rgba(56,189,248,0.04)",
            "circle-stroke-color": "rgba(56,189,248,0.2)",
            "circle-stroke-width": 1,
          },
        });

        setMapLoaded(true);
        setMapError(false);
      });

      map.on("dragstart", () => setAutoCenter(false));
      map.on("wheel", () => setAutoCenter(false));
      map.on("error", () => setMapError(true));

      mapRef.current = map;
      return () => { map.remove(); mapRef.current = null; };
    } catch {
      setMapError(true);
    }
  }, []);

  // Create drone marker element
  const createDroneEl = useCallback((hdg: number) => {
    const el = document.createElement("div");
    el.style.cssText = "width:34px;height:34px;position:relative;display:flex;align-items:center;justify-content:center;";
    el.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);animation:pulse-slow 2s ease-in-out infinite;"></div>
      <div id="drone-arrow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:18px solid #10B981;transform:rotate(${hdg}deg);filter:drop-shadow(0 0 5px rgba(16,185,129,0.6));transition:transform 0.3s ease;"></div>
    `;
    return el;
  }, []);

  // Create target marker element
  const createTargetEl = useCallback(() => {
    const el = document.createElement("div");
    el.style.cssText = "width:44px;height:44px;position:relative;display:flex;align-items:center;justify-content:center;";
    el.innerHTML = `
      <div style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(220,38,38,0.4);animation:pulse-slow 2s ease-in-out infinite;"></div>
      <div style="position:absolute;width:22px;height:22px;border:1.5px dashed rgba(220,38,38,0.7);border-radius:50%;animation:spin-slow 6s linear infinite;"></div>
      <div style="width:5px;height:5px;border-radius:50%;background:#DC2626;box-shadow:0 0 8px rgba(220,38,38,0.8);"></div>
      <div style="position:absolute;top:-16px;left:50%;transform:translateX(-50%);background:#0c0e12;border:1px solid rgba(220,38,38,0.5);padding:1px 5px;border-radius:1px;font-family:'JetBrains Mono',monospace;font-size:7.5px;font-weight:700;color:#EF4444;letter-spacing:0.08em;white-space:nowrap;">TARGET LOCK</div>
    `;
    return el;
  }, []);

  // Update map on telemetry changes
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || isStale) return;
    const map = mapRef.current;

    // Drone marker
    if (hasGps) {
      if (!droneMarkerRef.current) {
        const el = createDroneEl(heading);
        droneElRef.current = el.querySelector("#drone-arrow") as HTMLDivElement;
        droneMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      } else {
        droneMarkerRef.current.setLngLat([lng, lat]);
        const arrow = droneMarkerRef.current.getElement().querySelector("#drone-arrow") as HTMLElement | null;
        if (arrow) arrow.style.transform = `rotate(${heading}deg)`;
      }
    } else {
      droneMarkerRef.current?.remove();
      droneMarkerRef.current = null;
    }

    // Target marker
    if (activeDetection) {
      const tLng = activeDetection.geolocation.lng;
      const tLat = activeDetection.geolocation.lat;
      if (!targetMarkerRef.current) {
        const el = createTargetEl();
        targetMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([tLng, tLat]).addTo(map);
      } else {
        targetMarkerRef.current.setLngLat([tLng, tLat]);
      }
    } else {
      targetMarkerRef.current?.remove();
      targetMarkerRef.current = null;
    }

    // Trail
    const trailSrc = map.getSource("trail") as maplibregl.GeoJSONSource | undefined;
    trailSrc?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: trail },
      properties: {},
    });

    // Vector
    const vecSrc = map.getSource("vector") as maplibregl.GeoJSONSource | undefined;
    vecSrc?.setData({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: activeDetection && hasGps
          ? [[lng, lat], [activeDetection.geolocation.lng, activeDetection.geolocation.lat]]
          : [],
      },
      properties: {},
    });

    // Search radius follows drone
    const radiusSrc = map.getSource("search-radius") as maplibregl.GeoJSONSource | undefined;
    radiusSrc?.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {},
    });

    // Auto-centering
    if (autoCenter && hasGps) {
      if ((ms === "CONFIRMED" || ms === "POSITIONED") && activeDetection) {
        const tLng = activeDetection.geolocation.lng;
        const tLat = activeDetection.geolocation.lat;
        map.easeTo({ center: [(lng + tLng) / 2, (lat + tLat) / 2], zoom: 16, duration: 600 });
      } else {
        map.easeTo({ center: [lng, lat], duration: 250 });
      }
    }
  }, [lat, lng, heading, ms, activeDetection, mapLoaded, trail, autoCenter, isStale, hasGps, createDroneEl, createTargetEl]);

  // Cleanup
  useEffect(() => {
    return () => {
      droneMarkerRef.current?.remove();
      targetMarkerRef.current?.remove();
    };
  }, []);

  if (mapError) {
    return (
      <div style={{
        width: "100%", height: "100%", background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)", borderRadius: 4,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, padding: 24, textAlign: "center",
      }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div style={{ position: "absolute", width: 32, height: 32, border: "1px dashed rgba(245,158,11,0.5)", borderRadius: "50%", animation: "spin-slow 8s linear infinite" }} />
          <div className="mono" style={{ fontSize: 8, color: "var(--warning)" }}>MAP</div>
        </div>
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: "var(--warning)", letterSpacing: "0.1em" }}>
          TACTICAL GRID UNAVAILABLE
        </div>
        <p style={{ fontSize: 9, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 300 }}>
          MapLibre stylesheet fetch failed. The CARTO Dark Matter basemap is unavailable. Check network connectivity.
        </p>
        <div style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)", borderRadius: 2, padding: "8px 12px", textAlign: "left", width: "100%", maxWidth: 320 }}>
          <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", marginBottom: 5, letterSpacing: "0.1em" }}>RAW COORDINATE READOUT</div>
          {[
            ["DRONE LAT", `${lat.toFixed(6)}°`],
            ["DRONE LNG", `${lng.toFixed(6)}°`],
            ["HEADING", `${heading.toFixed(1)}°`],
            ["TARGET", activeDetection ? "ACQUIRED" : "NONE"],
          ].map(([l, v]) => (
            <div key={l} className="telem-row">
              <span className="telem-label">{l}</span>
              <span className="telem-value" style={{ fontSize: 10 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 4, overflow: "hidden", background: "#0c0e12" }}>
      {/* Map container */}
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

      {/* GPS flash overlay */}
      <div style={{
        position: "absolute", inset: 0, background: "rgba(239,68,68,0.15)",
        pointerEvents: "none", zIndex: 5,
        opacity: gpsFlashActive ? 1 : 0,
        transition: "opacity 0.15s ease",
      }} />

      {/* Compass rings (decorative tactical overlay — subtle) */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, overflow: "hidden" }}>
        {[85, 55, 25].map((pct, i) => (
          <div key={i} style={{
            position: "absolute",
            top: "50%", left: "50%",
            width: `${pct}%`, height: `${pct}%`,
            border: "1px solid rgba(255,255,255,0.03)",
            borderRadius: "50%",
            transform: "translate(-50%, -50%)",
          }} />
        ))}
        {/* Cardinal marks */}
        <div className="mono" style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>N</div>
        <div className="mono" style={{ position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>S</div>
        <div className="mono" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>E</div>
        <div className="mono" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>W</div>
      </div>

      {/* Status bar — top left */}
      <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10, display: "flex", gap: 6 }}>
        <div style={{
          background: "rgba(9,10,12,0.85)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 2, padding: "3px 8px", display: "flex", alignItems: "center", gap: 5,
          backdropFilter: "blur(2px)",
        }}>
          <div style={{
            width: 5, height: 5, borderRadius: "50%",
            background: autoCenter ? "#10B981" : "var(--text-muted)",
            animation: autoCenter ? "pulse-slow 2s ease-in-out infinite" : undefined,
          }} />
          <span className="mono" style={{ fontSize: 8, color: "rgba(255,255,255,0.8)", letterSpacing: "0.1em" }}>
            {autoCenter ? "AUTO-TRACK" : "MANUAL PAN"}
          </span>
        </div>
        {!hasGps && (
          <div style={{
            background: "rgba(239,68,68,0.9)", border: "1px solid rgba(239,68,68,0.6)",
            borderRadius: 2, padding: "3px 8px",
          }}>
            <span className="mono" style={{ fontSize: 8, color: "#fff", fontWeight: 700, letterSpacing: "0.1em" }}>⚠ GPS LOSS</span>
          </div>
        )}
      </div>

      {/* Re-center button */}
      {!autoCenter && hasGps && !isStale && (
        <button
          onClick={() => setAutoCenter(true)}
          style={{
            position: "absolute", bottom: 12, right: 12, zIndex: 10,
            padding: "5px 10px", borderRadius: 2,
            background: "var(--info)", border: "none",
            color: "#000", fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em",
            cursor: "pointer", textTransform: "uppercase",
          }}
        >
          ⊕ LOCK DRONE
        </button>
      )}

      {/* Mission state overlay */}
      <div style={{
        position: "absolute", bottom: 8, left: 8, zIndex: 10,
        background: "rgba(9,10,12,0.85)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 2, padding: "4px 8px", backdropFilter: "blur(2px)",
      }}>
        <div className="mono" style={{ fontSize: 7.5, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginBottom: 1 }}>MISSION STATE</div>
        <div className="mono" style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em",
          color: ms === "ARMED" || ms === "EXECUTED" ? "#DC2626" : ms === "POSITIONED" ? "#F59E0B" : "#38BDF8",
        }}>
          {ms}
        </div>
      </div>
    </div>
  );
};
