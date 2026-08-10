import React, { useState, useEffect } from "react";
import { useSimulation } from "../../simulation/SimulationProvider";
import { Heart, Activity, Radio, Cpu, Battery, Compass, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

/* ── Health card component ─────────────────────────────────────────────────── */
const HealthCard: React.FC<{
  number: string;
  title: string;
  icon: React.ReactNode;
  status: "NOMINAL" | "WARNING" | "CRITICAL" | "OFFLINE" | "STANDBY";
  metrics: Array<{ label: string; value: string; valueColor?: string }>;
  note: string;
}> = ({ number, title, icon, status, metrics, note }) => {
  const statusStyle = {
    NOMINAL:  { color: "#10B981", bg: "rgba(16,185,129,0.1)",  border: "rgba(16,185,129,0.3)" },
    WARNING:  { color: "#F59E0B", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.3)" },
    CRITICAL: { color: "#EF4444", bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)", anim: "pulse-slow 0.8s ease-in-out infinite" },
    OFFLINE:  { color: "#EF4444", bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)" },
    STANDBY:  { color: "#475569", bg: "rgba(71,85,105,0.1)",   border: "rgba(71,85,105,0.3)" },
  }[status];

  return (
    <div className="panel" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: "var(--info)" }}>{icon}</span>
          <div>
            <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em" }}>{number}</div>
            <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.08em" }}>{title}</div>
          </div>
        </div>
        <div style={{
          padding: "2px 8px", borderRadius: 2,
          background: statusStyle.bg, border: `1px solid ${statusStyle.border}`,
          color: statusStyle.color, fontFamily: "'JetBrains Mono', monospace",
          fontSize: 8, fontWeight: 700, letterSpacing: "0.1em",
          animation: (statusStyle as any).anim,
        }}>
          {status}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
        {metrics.map(({ label, value, valueColor }) => (
          <div key={label} className="telem-row">
            <span className="telem-label">{label}</span>
            <span className="telem-value" style={{ fontSize: 10, color: valueColor || "var(--text-primary)" }}>{value}</span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 8, color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border-subtle)", paddingTop: 6, margin: 0 }}>
        {note}
      </p>
    </div>
  );
};

/* ── System Health Page ─────────────────────────────────────────────────────── */
export const SystemHealth: React.FC = () => {
  const { telemetry } = useSimulation();

  const isStale = telemetry.provenance === "STALE";
  const gpsFix = telemetry.system.gps_fix;
  const signalDbm = telemetry.system.signal_dbm;
  const batteryPct = telemetry.system.battery_pct;
  const hasGps = gpsFix !== "NO_FIX";

  const [cpuTemp, setCpuTemp] = useState(42.4);
  const [inferMs, setInferMs] = useState(24.2);
  const [currentA, setCurrentA] = useState(8.4);
  const [pktRate, setPktRate] = useState(10.0);

  useEffect(() => {
    if (isStale) return;
    const id = setInterval(() => {
      setCpuTemp(p => +(Math.min(68, Math.max(36, p + (Math.random() - 0.5) * 2))).toFixed(1));
      setInferMs(p => +(Math.min(34, Math.max(16, p + (Math.random() - 0.5) * 1.5))).toFixed(1));
      setCurrentA(p => +(Math.min(12, Math.max(6, p + (Math.random() - 0.5) * 0.4))).toFixed(2));
      setPktRate(p => +(Math.min(10.2, Math.max(9.6, p + (Math.random() - 0.5) * 0.15))).toFixed(1));
    }, 1500);
    return () => clearInterval(id);
  }, [isStale]);

  const S = (v: string) => isStale ? "---" : v;

  const gpsStatus = (): "NOMINAL" | "WARNING" | "CRITICAL" | "OFFLINE" => {
    if (isStale) return "OFFLINE";
    if (gpsFix === "NO_FIX") return "CRITICAL";
    if (gpsFix === "RTK_FLOAT" || gpsFix === "3D_FIX") return "WARNING";
    return "NOMINAL";
  };

  const signalStatus = (): "NOMINAL" | "WARNING" | "CRITICAL" | "OFFLINE" => {
    if (isStale) return "OFFLINE";
    if (signalDbm > -70) return "NOMINAL";
    if (signalDbm > -85) return "WARNING";
    return "CRITICAL";
  };

  const battStatus = (): "NOMINAL" | "WARNING" | "CRITICAL" | "OFFLINE" => {
    if (isStale) return "OFFLINE";
    if (batteryPct > 30) return "NOMINAL";
    if (batteryPct > 15) return "WARNING";
    return "CRITICAL";
  };

  const overallStatus = (): "NOMINAL" | "WARNING" | "CRITICAL" | "OFFLINE" => {
    if (isStale) return "OFFLINE";
    if (gpsFix === "NO_FIX" || batteryPct < 15) return "CRITICAL";
    if (signalDbm < -80 || batteryPct < 30 || gpsFix !== "RTK_FIXED") return "WARNING";
    return "NOMINAL";
  };

  const overall = overallStatus();
  const overallIcon = overall === "NOMINAL" ? <CheckCircle2 size={14} style={{ color: "#10B981" }} />
    : overall === "CRITICAL" || overall === "OFFLINE" ? <XCircle size={14} style={{ color: "#EF4444" }} />
    : <AlertTriangle size={14} style={{ color: "#F59E0B" }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg-base)", padding: 8, gap: 8 }}>
      {/* Header */}
      <div className="panel" style={{ padding: "8px 12px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Heart size={14} style={{ color: "var(--info)" }} />
          <div>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.12em" }}>
              SYSTEM HEALTH DIAGNOSTICS
            </div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 1 }}>
              DR-07 · LIVE SENSOR MONITORING
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)", borderRadius: 2 }}>
          {overallIcon}
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: overall === "NOMINAL" ? "#10B981" : overall === "CRITICAL" || overall === "OFFLINE" ? "#EF4444" : "#F59E0B", letterSpacing: "0.1em" }}>
            {overall === "NOMINAL" ? "ALL STATIONS NOMINAL" :
             overall === "OFFLINE" ? "SYSTEMS OFFLINE — STALE LINK" :
             overall === "CRITICAL" ? "CRITICAL CONDITIONS DETECTED" :
             "CAUTION — DEGRADED STATIONS"}
          </span>
        </div>
      </div>

      {/* 3×2 health card grid */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, minHeight: 0, overflow: "auto" }}>
        <HealthCard
          number="01"
          title="Telemetry Heartbeat"
          icon={<Activity size={13} />}
          status={isStale ? "OFFLINE" : "NOMINAL"}
          metrics={[
            { label: "HEARTBEAT RATE", value: S(`${pktRate} Hz`) },
            { label: "AVG LINK LATENCY", value: S("84 ms") },
            { label: "PROVENANCE", value: isStale ? "STALE" : telemetry.provenance, valueColor: isStale ? "var(--critical)" : telemetry.provenance === "LIVE" ? "var(--nominal)" : "var(--warning)" },
            { label: "PKT SEQUENCE", value: S("841299") },
          ]}
          note="Triggers stale state if heartbeat exceeds 1500ms gate. Disarms all safety gates."
        />

        <HealthCard
          number="02"
          title="GPS Positioning Engine"
          icon={<Compass size={13} />}
          status={gpsStatus()}
          metrics={[
            { label: "FIX MODE", value: S(gpsFix), valueColor: !hasGps ? "var(--critical)" : "var(--text-primary)" },
            { label: "TRACKED SATS", value: S(`${telemetry.system.satellites}`) },
            { label: "HDOP PRECISION", value: S(gpsFix === "RTK_FIXED" ? "0.82" : gpsFix === "RTK_FLOAT" ? "1.44" : "N/A") },
            { label: "COORD SYNC", value: S(hasGps ? "LOCKED" : "UNSYNCED"), valueColor: hasGps && !isStale ? "var(--nominal)" : "var(--critical)" },
          ]}
          note="RTK_FIXED required for operator arming authorization. GPS loss immediately suspends consequential actions."
        />

        <HealthCard
          number="03"
          title="Radio Transceiver Link"
          icon={<Radio size={13} />}
          status={signalStatus()}
          metrics={[
            { label: "SIGNAL STRENGTH", value: S(`${signalDbm} dBm`), valueColor: signalDbm > -70 ? "var(--nominal)" : signalDbm > -85 ? "var(--warning)" : "var(--critical)" },
            { label: "RF FREQUENCY", value: "5.8 GHz FHSS" },
            { label: "NOISE FLOOR", value: "-104 dBm" },
            { label: "BANDWIDTH", value: "2.4 Mbps" },
          ]}
          note="Degraded warning at <-70dBm. Critical at <-85dBm. Triggers automatic telemetry stale conditions."
        />

        <HealthCard
          number="04"
          title="FLIR Stabilized Gimbal"
          icon={<Activity size={13} />}
          status={isStale ? "OFFLINE" : "NOMINAL"}
          metrics={[
            { label: "SENSOR TEMP", value: S("32.4°C") },
            { label: "AXIS ENCODERS", value: S("3-AXIS ALIGNED") },
            { label: "COMPRESSION", value: "H.265 AVC" },
            { label: "PAYLOAD LOCK", value: S("SECURED"), valueColor: "var(--nominal)" },
          ]}
          note="Gimbal stabilization ensures precise thermal target coordinates align with tactical map."
        />

        <HealthCard
          number="05"
          title="AI Inference Unit"
          icon={<Cpu size={13} />}
          status={isStale ? "STANDBY" : "NOMINAL"}
          metrics={[
            { label: "MODEL", value: "YOLO-SAR-V8" },
            { label: "INFERENCE LATENCY", value: S(`${inferMs} ms`) },
            { label: "GPU TEMPERATURE", value: S(`${cpuTemp}°C`), valueColor: cpuTemp > 60 ? "var(--warning)" : "var(--text-primary)" },
            { label: "LOCK THRESHOLD", value: "85.0% CONF" },
          ]}
          note="Onboard inference. Temperature throttling active above 65°C. Stale link triggers standby."
        />

        <HealthCard
          number="06"
          title="Power Management System"
          icon={<Battery size={13} />}
          status={battStatus()}
          metrics={[
            { label: "BATTERY LEVEL", value: S(`${batteryPct.toFixed(1)}%`), valueColor: batteryPct < 15 ? "var(--critical)" : batteryPct < 30 ? "var(--warning)" : "var(--nominal)" },
            { label: "CELL VOLTAGE", value: S(`${(22.2 * (batteryPct / 100 + 0.08)).toFixed(2)} V`) },
            { label: "CURRENT DRAW", value: S(`${currentA} A`) },
            { label: "CELL TEMP", value: S("36.5°C") },
          ]}
          note="Warning at <30%. Critical <15% triggers autonomous RTH failsafe. Arming suspended during critical state."
        />
      </div>
    </div>
  );
};
