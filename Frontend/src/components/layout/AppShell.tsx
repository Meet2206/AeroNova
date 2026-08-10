import React, { useState, useEffect } from "react";
import { useSimulation } from "../../simulation/SimulationProvider";
import { Video, FileCode, Heart, AlertTriangle, Battery, Wifi, Compass, RefreshCw } from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
}

export const AppShell: React.FC<AppShellProps> = ({ children, currentPath, onNavigate }) => {
  const { telemetry, scenario, setScenario, resetMission } = useSimulation();

  const isStale = telemetry.provenance === "STALE";
  const isGpsLost = telemetry.system.gps_fix === "NO_FIX";

  const [latency, setLatency] = useState(84);
  useEffect(() => {
    if (isStale) return;
    const id = setInterval(() => {
      setLatency(p => Math.min(140, Math.max(35, p + Math.floor((Math.random() - 0.5) * 18))));
    }, 1800);
    return () => clearInterval(id);
  }, [isStale]);

  const getSignalBars = (dbm: number) => {
    if (isStale) return "░░░░░░░░";
    if (dbm > -65) return "████████";
    if (dbm > -75) return "██████░░";
    if (dbm > -85) return "████░░░░";
    return "██░░░░░░";
  };

  const signalColor = () => {
    if (isStale) return "var(--text-muted)";
    if (telemetry.system.signal_dbm > -70) return "var(--nominal)";
    if (telemetry.system.signal_dbm > -85) return "var(--warning)";
    return "var(--critical)";
  };

  const batteryColor = () => {
    if (isStale) return "var(--text-muted)";
    const p = telemetry.system.battery_pct;
    if (p > 30) return "var(--nominal)";
    if (p > 15) return "var(--warning)";
    return "var(--critical)";
  };

  const provBadge = () => {
    if (isStale) return { color: "var(--critical)", label: "⚠ TELEMETRY STALE", dot: "blink" };
    if (telemetry.provenance === "SIMULATED") return { color: "var(--warning)", label: "● SIMULATED", dot: "" };
    return { color: "var(--nominal)", label: "● LIVE", dot: "" };
  };

  const prov = provBadge();

  const isDash = currentPath === "#/dashboard" || currentPath === "" || currentPath === "#/";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", overflow: "hidden", background: "var(--bg-base)" }}>
      {/* Critical border highlights */}
      {isStale && (
        <div style={{ position: "fixed", inset: 0, border: "2px solid rgba(239,68,68,0.35)", pointerEvents: "none", zIndex: 9999 }} />
      )}
      {isGpsLost && !isStale && (
        <div style={{ position: "fixed", inset: 0, border: "2px solid rgba(245,158,11,0.25)", pointerEvents: "none", zIndex: 9999 }} />
      )}

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "6px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        zIndex: 50,
      }}>
        {/* Branding + Provenance */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono" style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.18em", color: "var(--text-primary)" }}>
                AERONOVA
              </span>
              <span className="mono" style={{ fontSize: 9, color: "var(--text-muted)" }}>/</span>
              <span className="mono" style={{ fontSize: 9, color: "var(--text-secondary)", letterSpacing: "0.14em" }}>MC-01</span>
            </div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.12em", marginTop: 1 }}>
              DISASTER RESPONSE MISSION CONTROL
            </div>
          </div>

          {/* Provenance badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "2px 8px",
            background: "var(--bg-overlay)",
            border: `1px solid ${prov.color}40`,
            borderRadius: 2,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: prov.color,
              animation: isStale ? "pulse-slow 0.6s ease-in-out infinite" : undefined,
            }} />
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: prov.color, letterSpacing: "0.1em" }}>
              {prov.label}
            </span>
          </div>
        </div>

        {/* Global system status telemetry bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* Signal */}
          <div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>
              SIGNAL
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Wifi size={11} style={{ color: signalColor() }} />
              <span className="mono" style={{ fontSize: 10, color: signalColor(), letterSpacing: "-0.02em" }}>
                {getSignalBars(telemetry.system.signal_dbm)}
              </span>
              <span className="mono" style={{ fontSize: 9, color: "var(--text-secondary)" }}>
                {isStale ? "---" : `${telemetry.system.signal_dbm} dBm`}
              </span>
            </div>
          </div>

          {/* Latency */}
          <div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>LATENCY</div>
            <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
              {isStale ? "--- ms" : `${latency} ms`}
            </span>
          </div>

          {/* Battery */}
          <div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>BATTERY</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Battery size={11} style={{ color: batteryColor() }} />
              <span className="mono" style={{
                fontSize: 12, fontWeight: 700, color: batteryColor(),
                animation: telemetry.system.battery_pct < 15 && !isStale ? "pulse-slow 0.8s ease-in-out infinite" : undefined,
              }}>
                {isStale ? "--%" : `${telemetry.system.battery_pct.toFixed(0)}%`}
              </span>
            </div>
          </div>

          {/* Drone ID */}
          <div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>NODE</div>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--info)" }}>{telemetry.drone_id}</span>
          </div>

          {/* Mission Mode */}
          <div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>OPERATION</div>
            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.06em" }}>
              SEARCH & RESCUE
            </span>
          </div>
        </div>
      </header>

      {/* ── NAV + DEV CONTROLS ──────────────────────────────────────────────── */}
      <div style={{
        background: "var(--bg-overlay)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "4px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        zIndex: 40,
      }}>
        <nav style={{ display: "flex", gap: 2 }}>
          {[
            { path: "#/dashboard", icon: <Compass size={11} />, label: "MISSION CONTROL", active: isDash },
            { path: "#/camera", icon: <Video size={11} />, label: "CAMERA", active: currentPath === "#/camera" },
            { path: "#/logs", icon: <FileCode size={11} />, label: "AUDIT LOGS", active: currentPath === "#/logs" },
            { path: "#/system-health", icon: <Heart size={11} />, label: "SYS HEALTH", active: currentPath === "#/system-health" },
          ].map(({ path, icon, label, active }) => (
            <button key={path} onClick={() => onNavigate(path)} className={`nav-btn ${active ? "active" : ""}`}>
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {/* Sim scenario quick controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.1em" }}>SIM OVERRIDE:</span>
          <div style={{
            display: "flex", gap: 2,
            background: "var(--bg-deep)",
            padding: "2px 3px",
            borderRadius: 2,
            border: "1px solid var(--border-subtle)"
          }}>
            {[
              { key: "NORMAL", color: "var(--nominal)" },
              { key: "DETECTION", color: "var(--info)" },
              { key: "GPS_LOSS", color: "var(--warning)" },
              { key: "SIGNAL_LOSS", color: "var(--warning)" },
              { key: "LOW_BATTERY", color: "var(--critical)" },
              { key: "STALE", color: "var(--critical)" },
            ].map(({ key, color }) => (
              <button
                key={key}
                onClick={() => setScenario(key)}
                style={{
                  padding: "1px 7px",
                  borderRadius: 1,
                  border: scenario === key ? `1px solid ${color}60` : "1px solid transparent",
                  background: scenario === key ? `${color}18` : "transparent",
                  color: scenario === key ? color : "var(--text-muted)",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  transition: "all 0.1s ease",
                }}
              >
                {key.replace("_", " ")}
              </button>
            ))}
          </div>
          <button
            onClick={resetMission}
            title="Reset Mission"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22,
              background: "var(--bg-deep)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 2,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={10} />
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {/* Stale telemetry modal overlay */}
        {isStale && (
          <div className="stale-overlay">
            <div style={{
              background: "var(--bg-surface)",
              border: "1px solid rgba(239,68,68,0.35)",
              borderRadius: 4,
              padding: "28px 36px",
              maxWidth: 460,
              textAlign: "center",
            }}>
              <AlertTriangle size={36} style={{ color: "var(--critical)", marginBottom: 14, display: "block", margin: "0 auto 14px" }} />
              <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--critical)", letterSpacing: "0.14em", marginBottom: 10 }}>
                ⚠ TELEMETRY HEARTBEAT LOST
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.7, marginBottom: 16 }}>
                Uplink from <strong style={{ color: "var(--text-primary)" }}>DR-07</strong> has exceeded the 1500ms heartbeat gate.
                All consequential operator actions are suspended until the link is re-established.
              </p>
              <div className="mono" style={{
                fontSize: 8.5,
                color: "var(--text-muted)",
                background: "var(--bg-base)",
                padding: "6px 10px",
                borderRadius: 2,
                border: "1px solid var(--border-subtle)",
                letterSpacing: "0.08em",
              }}>
                USE SIM OVERRIDE PANEL → NORMAL TO RESTORE
              </div>
            </div>
          </div>
        )}

        {children}
      </main>
    </div>
  );
};
