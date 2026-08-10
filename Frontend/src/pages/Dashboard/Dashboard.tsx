import React, { useState, useEffect, useRef } from "react";
import { useSimulation } from "../../simulation/SimulationProvider";
import { TacticalMap } from "../../components/map/TacticalMap";
import {
  Shield, ShieldAlert, Download, EyeOff, Radio, Lock, Unlock, ChevronsRight, CheckCircle
} from "lucide-react";

/* ─── Reusable metric cell ─────────────────────────────────────────────────── */
const MetricCell: React.FC<{
  label: string;
  value: string;
  valueColor?: string;
  wide?: boolean;
}> = ({ label, value, valueColor, wide }) => (
  <div style={{
    background: "var(--bg-overlay)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 2,
    padding: "5px 8px",
    gridColumn: wide ? "span 2" : undefined,
  }}>
    <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>
      {label}
    </div>
    <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: valueColor || "var(--text-primary)" }}>
      {value}
    </div>
  </div>
);

/* ─── FSM step row ─────────────────────────────────────────────────────────── */
const FSMStep: React.FC<{
  label: string;
  description: string;
  status: "done" | "active" | "armed" | "pending";
  isLast?: boolean;
}> = ({ label, description, status, isLast }) => {
  const nodeClass = {
    done: "fsm-node-done",
    active: "fsm-node-active",
    armed: "fsm-node-armed",
    pending: "fsm-node-pending",
  }[status];

  const textColor = {
    done: "var(--text-muted)",
    active: "var(--info)",
    armed: "var(--critical)",
    pending: "var(--text-muted)",
  }[status];

  const labelWeight = status === "pending" ? 400 : 600;

  return (
    <div style={{ display: "flex", gap: 10, position: "relative", paddingBottom: isLast ? 0 : 10 }}>
      {/* connector */}
      {!isLast && (
        <div style={{
          position: "absolute",
          left: 4.5, top: 12, bottom: 0,
          width: 1,
          background: status === "done" ? "rgba(16,185,129,0.4)" : "var(--border-subtle)",
        }} />
      )}
      {/* node */}
      <div className={nodeClass} style={{ marginTop: 1 }} />
      {/* label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="mono" style={{ fontSize: 9.5, fontWeight: labelWeight, color: textColor, letterSpacing: "0.08em" }}>
            {label}
          </span>
          {status === "done" && (
            <span className="badge badge-nominal">DONE</span>
          )}
          {(status === "active" || status === "armed") && (
            <span className={`badge ${status === "armed" ? "badge-critical" : "badge-info"}`}>
              ACTIVE
            </span>
          )}
        </div>
        {(status === "active" || status === "armed") && (
          <p style={{ fontSize: 8.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5 }}>{description}</p>
        )}
      </div>
    </div>
  );
};

/* ─── Main Dashboard ───────────────────────────────────────────────────────── */
export const Dashboard: React.FC = () => {
  const {
    telemetry,
    activeDetection,
    confidenceHistory,
    events,
    armSystem,
    disarmSystem,
    executeAction,
    dismissDetection,
    exportEventsJson
  } = useSimulation();

  const [slideVal, setSlideVal] = useState(0);
  const eventEndRef = useRef<HTMLDivElement>(null);

  const isStale = telemetry.provenance === "STALE";
  const ms = telemetry.mission_state;
  const hasGps = telemetry.system.gps_fix !== "NO_FIX";

  useEffect(() => {
    eventEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  useEffect(() => {
    if (slideVal >= 100) {
      armSystem();
      setSlideVal(0);
    }
  }, [slideVal]);

  useEffect(() => {
    if (ms !== "POSITIONED") setSlideVal(0);
  }, [ms]);

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}.${String(d.getMilliseconds()).padStart(3,"0")}`;
  };

  const evtTypeColor = (t: string) => {
    switch (t) {
      case "AI":      return { bg: "rgba(16,185,129,0.12)", color: "var(--nominal)", border: "rgba(16,185,129,0.3)" };
      case "MISSION": return { bg: "rgba(168,85,247,0.12)", color: "#A855F7",         border: "rgba(168,85,247,0.3)" };
      case "SAFETY":  return { bg: "rgba(239,68,68,0.12)",  color: "var(--critical)",  border: "rgba(239,68,68,0.3)" };
      case "OPERATOR":return { bg: "rgba(56,189,248,0.12)", color: "var(--info)",      border: "rgba(56,189,248,0.3)" };
      case "WARNING": return { bg: "rgba(245,158,11,0.12)", color: "var(--warning)",   border: "rgba(245,158,11,0.3)" };
      case "ERROR":   return { bg: "rgba(239,68,68,0.18)",  color: "var(--critical)",  border: "rgba(239,68,68,0.4)" };
      case "SYSTEM":  return { bg: "rgba(56,189,248,0.08)", color: "var(--info)",      border: "rgba(56,189,248,0.2)" };
      default:        return { bg: "rgba(255,255,255,0.04)", color: "var(--text-muted)", border: "var(--border-subtle)" };
    }
  };

  /* FSM step status resolver */
  const order = ["SEARCHING","DETECTED","CONFIRMED","POSITIONED","ARMED","EXECUTED"] as const;
  const ci = order.indexOf(ms);
  const stepStatus = (s: typeof ms): "done" | "active" | "armed" | "pending" => {
    const si = order.indexOf(s);
    if (si < ci) return "done";
    if (si === ci) return (s === "ARMED" || s === "EXECUTED") ? "armed" : "active";
    return "pending";
  };

  /* Sparkline path builder */
  const sparkPath = () => {
    if (confidenceHistory.length < 2) return "";
    const W = 160, H = 26;
    return confidenceHistory.map((v, i) => {
      const x = (i / (confidenceHistory.length - 1)) * W;
      const y = H - ((Math.max(0.4, v) - 0.4) / 0.65) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  };

  /* Safety gate component */
  const SafetyGate = () => {
    if (ms === "EXECUTED") return (
      <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 4, padding: "10px 12px", textAlign: "center" }}>
        <CheckCircle size={16} style={{ color: "var(--nominal)", display: "block", margin: "0 auto 6px" }} />
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: "var(--nominal)", letterSpacing: "0.1em", marginBottom: 4 }}>MISSION EXECUTED</div>
        <p style={{ fontSize: 8.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Payload dispense complete. Drone entering autonomous RTH mode.
        </p>
      </div>
    );

    if (ms === "ARMED") return (
      <div className="safety-gate-armed" style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <ShieldAlert size={14} style={{ color: "var(--armed)", animation: "pulse-slow 0.6s ease-in-out infinite" }} />
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: "var(--armed)", letterSpacing: "0.1em" }}>
            ⚠ SYSTEM ARMED
          </span>
        </div>
        <p style={{ fontSize: 8.5, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 10 }}>
          Payload release solenoid armed. Operator authorization required to execute.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button
            onClick={disarmSystem}
            style={{
              padding: "6px 0", borderRadius: 2, border: "1px solid var(--border-strong)",
              background: "var(--bg-overlay)", color: "var(--text-secondary)", cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Cancel
          </button>
          <button
            onClick={executeAction}
            style={{
              padding: "6px 0", borderRadius: 2, border: "1px solid var(--armed)",
              background: "var(--armed)", color: "#fff", cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Authorize
          </button>
        </div>
      </div>
    );

    if (ms === "POSITIONED" && !isStale && hasGps) return (
      <div className="safety-gate-ready" style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
          <Unlock size={11} style={{ color: "var(--critical)" }} />
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: "var(--critical)", letterSpacing: "0.1em" }}>
            TARGET POSITION VERIFIED
          </span>
        </div>
        {/* Slide-to-arm */}
        <div style={{
          position: "relative", height: 36, borderRadius: 2,
          background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)",
          overflow: "hidden", userSelect: "none",
        }}>
          {/* Fill */}
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${slideVal}%`,
            background: "rgba(220,38,38,0.2)",
            transition: "width 0.05s linear",
          }} />
          {/* Thumb */}
          <div style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${slideVal}%`,
            width: 36, marginLeft: -18,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--armed)", borderRadius: 2,
            boxShadow: "0 0 12px rgba(220,38,38,0.5)",
            pointerEvents: "none",
            transition: "left 0.05s linear",
          }}>
            <Unlock size={12} style={{ color: "#fff" }} />
          </div>
          {/* Guide text */}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", gap: 4,
          }}>
            <ChevronsRight size={10} style={{ color: "rgba(220,38,38,0.6)" }} />
            <span className="mono" style={{ fontSize: 8.5, color: "rgba(220,38,38,0.7)", letterSpacing: "0.12em", fontWeight: 700 }}>
              SLIDE TO ARM
            </span>
          </div>
          {/* Invisible input */}
          <input
            type="range"
            min="0" max="100"
            value={slideVal}
            onChange={e => setSlideVal(+e.target.value)}
            onPointerUp={() => { if (slideVal < 100) setSlideVal(0); }}
            onMouseUp={() => { if (slideVal < 100) setSlideVal(0); }}
            className="arm-slider"
            aria-label="Slide to arm"
          />
        </div>
      </div>
    );

    // Locked (not yet positioned, or stale/gps lost)
    const lockReason = isStale ? "Telemetry stale — link required"
      : !hasGps ? "GPS fix required"
      : "Awaiting target positioning";

    return (
      <div className="safety-gate-locked" style={{ padding: "10px 12px", textAlign: "center" }}>
        <Lock size={14} style={{ color: "var(--text-muted)", display: "block", margin: "0 auto 6px" }} />
        <div className="mono" style={{ fontSize: 9.5, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>
          SAFETY GATE LOCKED
        </div>
        <p style={{ fontSize: 8.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{lockReason}</p>
      </div>
    );
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
      background: "var(--bg-base)", padding: "8px", gap: 8,
    }}>
      {/* ── THREE-COLUMN WORKSPACE ─────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, gap: 8, minHeight: 0 }}>

        {/* ── LEFT: AI DETECTION PANEL ──────────────────────────────────── */}
        <div className="panel" style={{
          width: 220, flexShrink: 0,
          display: "flex", flexDirection: "column", padding: "10px", gap: 0, minHeight: 0, overflow: "hidden",
        }}>
          <div className="panel-header">
            <Radio size={10} style={{ color: "var(--info)", animation: activeDetection ? "pulse-slow 1.5s ease-in-out infinite" : undefined }} />
            AI DETECTION
          </div>

          {activeDetection ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "hidden" }}>
              {/* Target header */}
              <div style={{
                background: "var(--bg-overlay)", border: "1px solid var(--border-strong)",
                borderRadius: 2, padding: "7px 9px", position: "relative",
              }}>
                <div style={{ position: "absolute", top: 6, right: 6, display: "flex", alignItems: "center", gap: 3 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--critical)", animation: "pulse-slow 0.6s ease-in-out infinite" }} />
                  <span className="mono" style={{ fontSize: 7, color: "var(--critical)", letterSpacing: "0.1em" }}>LOCK</span>
                </div>
                <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 3 }}>
                  TARGET · D-042
                </div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>
                  {activeDetection.class.replace("_", " ")}
                </div>
                <div className="mono" style={{ fontSize: 8.5, color: "var(--info)" }}>
                  {ms === "CONFIRMED" || ms === "POSITIONED" || ms === "ARMED" || ms === "EXECUTED"
                    ? "CONFIRMED ✓" : "DETECTING..."}
                </div>
              </div>

              {/* Confidence section */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <span className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em" }}>CONFIDENCE</span>
                  <span className="mono" style={{
                    fontSize: 20, fontWeight: 700,
                    color: activeDetection.confidence >= 0.85 ? "var(--nominal)" : "var(--warning)",
                    lineHeight: 1,
                  }}>
                    {(activeDetection.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="confidence-bar-track">
                  <div className="confidence-bar-fill" style={{ width: `${activeDetection.confidence * 100}%` }} />
                </div>
                {/* 0.85 threshold marker */}
                <div style={{ position: "relative", height: 10 }}>
                  <div style={{
                    position: "absolute", left: "85%", top: 0,
                    width: 1, height: 10, background: "rgba(56,189,248,0.5)",
                  }} />
                  <span className="mono" style={{
                    position: "absolute", left: "85%", top: 1,
                    fontSize: 6.5, color: "var(--info)", transform: "translateX(-50%)", marginLeft: 1,
                  }}>85%</span>
                </div>
              </div>

              {/* Sparkline timeline */}
              <div style={{
                background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)",
                borderRadius: 2, padding: "6px 8px",
              }}>
                <div className="mono" style={{ fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 4 }}>
                  CONFIDENCE TIMELINE
                </div>
                <svg width="100%" height="28" viewBox={`0 0 160 26`} preserveAspectRatio="none">
                  <line x1="0" y1="0" x2="160" y2="0" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  <line x1="0" y1="13" x2="160" y2="13" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  <line x1="0" y1="26" x2="160" y2="26" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  {/* 85% threshold */}
                  <line x1="0" y1={26 - ((0.85-0.4)/0.65)*26} x2="160" y2={26 - ((0.85-0.4)/0.65)*26} stroke="rgba(56,189,248,0.25)" strokeWidth="0.5" strokeDasharray="2,2" />
                  {confidenceHistory.length > 1 && (
                    <path d={sparkPath()} fill="none" stroke="var(--nominal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
                <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 6.5, color: "var(--text-muted)", marginTop: 2 }}>
                  <span>-{(confidenceHistory.length * 0.1).toFixed(1)}s</span>
                  <span>NOW</span>
                </div>
              </div>

              {/* Evidence signals */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minHeight: 0, overflow: "auto" }}>
                <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>EVIDENCE SIGNALS</div>
                {[
                  { label: "THERMAL SIGNATURE", val: activeDetection.confidence >= 0.85 ? 92 : 64 },
                  { label: "MOTION VECTOR", val: activeDetection.confidence >= 0.85 ? 87 : 51 },
                  { label: "SHAPE MATCH", val: activeDetection.confidence >= 0.85 ? 81 : 44 },
                ].map(({ label, val }) => (
                  <div key={label} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)",
                    borderRadius: 2, padding: "4px 7px",
                  }}>
                    <span className="mono" style={{ fontSize: 7.5, color: "var(--text-secondary)", letterSpacing: "0.05em" }}>{label}</span>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--nominal)" }}>{val}%</span>
                  </div>
                ))}
                <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", marginTop: 4, letterSpacing: "0.06em" }}>
                  3 / 3 SIGNALS POSITIVE
                </div>

                <div style={{
                  background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)",
                  borderRadius: 2, padding: "5px 7px",
                }}>
                  <div className="mono" style={{ fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 3 }}>GEOLOCATION</div>
                  <div className="mono" style={{ fontSize: 8.5, color: "var(--text-primary)" }}>
                    {activeDetection.geolocation.lat.toFixed(6)}° N
                  </div>
                  <div className="mono" style={{ fontSize: 8.5, color: "var(--text-primary)" }}>
                    {Math.abs(activeDetection.geolocation.lng).toFixed(6)}° W
                  </div>
                </div>
              </div>

              {/* Dismiss */}
              <button
                onClick={dismissDetection}
                disabled={isStale}
                style={{
                  marginTop: 6,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  padding: "6px 0", borderRadius: 2,
                  background: "transparent", border: "1px solid var(--border-strong)",
                  color: "var(--text-secondary)", cursor: isStale ? "not-allowed" : "pointer",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 600,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  opacity: isStale ? 0.4 : 1,
                  transition: "all 0.12s ease",
                }}
              >
                <EyeOff size={11} /> Dismiss Target
              </button>
            </div>
          ) : (
            <div style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              border: "1px dashed var(--border-subtle)", borderRadius: 2, padding: 16, textAlign: "center", gap: 8,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", animation: "pulse-slow 2s ease-in-out infinite" }} />
              </div>
              <div className="mono" style={{ fontSize: 9, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.1em" }}>
                SCANNING SECTOR
              </div>
              <p style={{ fontSize: 8.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                Autonomous drone sweeping active search pattern.
              </p>
            </div>
          )}
        </div>

        {/* ── CENTER: TACTICAL MAP ──────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, borderRadius: 4, overflow: "hidden", position: "relative" }}>
          <TacticalMap />
        </div>

        {/* ── RIGHT: TELEMETRY + FSM + SAFETY ──────────────────────────── */}
        <div style={{
          width: 224, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 0,
        }}>
          {/* Telemetry panel */}
          <div className="panel" style={{ padding: 10, flexShrink: 0 }}>
            <div className="panel-header">TELEMETRY · DR-07</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <MetricCell label="ALT MSL" value={isStale ? "---" : `${telemetry.location.alt_msl.toFixed(1)} m`} />
              <MetricCell label="ALT REL" value={isStale ? "---" : `${telemetry.location.alt_relative.toFixed(1)} m`} />
              <MetricCell label="SPEED" value={isStale ? "---" : `${Math.hypot(telemetry.kinematics.vx, telemetry.kinematics.vy).toFixed(1)} m/s`} />
              <MetricCell label="HEADING" value={isStale ? "---" : `${telemetry.location.heading.toFixed(1)}°`} />
              <MetricCell label="GPS FIX" value={isStale ? "---" : telemetry.system.gps_fix}
                valueColor={!hasGps ? "var(--critical)" : "var(--text-primary)"} />
              <MetricCell label="SATS" value={isStale ? "0" : `${telemetry.system.satellites}`} />
            </div>
            <div style={{ marginTop: 5, padding: "4px 6px", background: "var(--bg-overlay)", borderRadius: 2, border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)" }}>PITCH</span>
                <span className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)" }}>ROLL</span>
                <span className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)" }}>YAW</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)" }}>
                  {isStale ? "--" : `${telemetry.kinematics.pitch.toFixed(1)}°`}
                </span>
                <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)" }}>
                  {isStale ? "--" : `${telemetry.kinematics.roll.toFixed(1)}°`}
                </span>
                <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)" }}>
                  {isStale ? "--" : `${telemetry.location.heading.toFixed(1)}°`}
                </span>
              </div>
            </div>
          </div>

          {/* Mission State panel */}
          <div className="panel" style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="panel-header">MISSION STATE</div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <FSMStep label="SEARCHING" description="Autonomous orbital search pattern active." status={stepStatus("SEARCHING")} />
              <FSMStep label="DETECTED" description="AI detection packet received. Confidence accumulating." status={stepStatus("DETECTED")} />
              <FSMStep label="CONFIRMED" description="Confidence ≥85%. Target lock acquired. Drone intercepting." status={stepStatus("CONFIRMED")} />
              <FSMStep label="POSITIONED" description="Station-keeping at target location. Safety gate eligible." status={stepStatus("POSITIONED")} />
              <FSMStep label="ARMED" description="Payload armed. Operator authorization required." status={stepStatus("ARMED")} />
              <FSMStep label="EXECUTED" description="Payload dispensed. Entering RTH mode." status={stepStatus("EXECUTED")} isLast />
            </div>
          </div>

          {/* Safety gate panel */}
          <div className="panel" style={{ padding: 10, flexShrink: 0 }}>
            <div className="panel-header">
              <Shield size={10} style={{ color: ms === "ARMED" ? "var(--armed)" : "var(--text-muted)" }} />
              SAFETY RELEASE GATE
            </div>
            <SafetyGate />
          </div>
        </div>
      </div>

      {/* ── EVENT STREAM BAR ────────────────────────────────────────────── */}
      <div className="panel" style={{
        height: 140, flexShrink: 0,
        display: "flex", flexDirection: "column", padding: "8px 10px", gap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--nominal)" }} />
            <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.12em" }}>
              OPERATIONAL AUDIT STREAM — MISSION RESCUE-042
            </span>
            <span className="badge badge-muted">{events.length} EVENTS</span>
          </div>
          <button
            onClick={exportEventsJson}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 2,
              background: "var(--bg-overlay)", border: "1px solid var(--border-strong)",
              color: "var(--text-secondary)", cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8, fontWeight: 600,
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}
          >
            <Download size={10} /> Export JSON
          </button>
        </div>

        {/* Scrollable log */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {events.map(evt => {
            const tc = evtTypeColor(evt.type);
            return (
              <div key={evt.id} className="event-row">
                <span className="event-ts">{formatTs(evt.timestamp)}</span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 7.5, fontWeight: 700,
                  padding: "1px 5px", borderRadius: 1,
                  border: `1px solid ${tc.border}`,
                  background: tc.bg, color: tc.color,
                  flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em",
                  minWidth: 56, textAlign: "center",
                }}>
                  {evt.type}
                </span>
                <span className="event-source">[{evt.source}]</span>
                <span className="event-msg">{evt.message}</span>
              </div>
            );
          })}
          <div ref={eventEndRef} />
        </div>
      </div>
    </div>
  );
};
