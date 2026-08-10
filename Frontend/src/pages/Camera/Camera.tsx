import React, { useEffect, useRef, useState } from "react";
import { useSimulation } from "../../simulation/SimulationProvider";
import { Video, ShieldCheck, Crosshair } from "lucide-react";

export const Camera: React.FC = () => {
  const { telemetry, activeDetection } = useSimulation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameCount, setFrameCount] = useState(1842);
  const [currentTime, setCurrentTime] = useState(new Date().toISOString());
  const animFrameRef = useRef<number | null>(null);

  const ms = telemetry.mission_state;

  // Frame counter at 30fps
  useEffect(() => {
    if (telemetry.provenance === "STALE") return;
    const id = setInterval(() => {
      setFrameCount(p => p + 1);
      setCurrentTime(new Date().toISOString());
    }, 33);
    return () => clearInterval(id);
  }, [telemetry.provenance]);

  // Thermal canvas loop (properly scoped dt)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let scanY = 0;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const w = canvas.width;
      const h = canvas.height;

      // ── Background
      ctx.fillStyle = "#0c0e12";
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.025)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < w; x += 48) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += 48) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Sensor grain
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let i = 0; i < 300; i++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 1.2, Math.random() * 1.2);
      }

      // ── Thermal signatures
      if (ms !== "SEARCHING" && activeDetection) {
        const conf = activeDetection.confidence;
        const progress = ms === "DETECTED"
          ? Math.max(0, Math.min(1, (conf - 0.55) / 0.36))
          : 1;

        const cx = w * (1 - 0.5 * progress);
        const cy = h * (1 - 0.5 * progress);
        const r = 28 + conf * 14;

        // Outer cool halo
        const g1 = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.2);
        g1.addColorStop(0, "rgba(239,68,68,0.12)");
        g1.addColorStop(1, "rgba(239,68,68,0)");
        ctx.fillStyle = g1;
        ctx.beginPath(); ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2); ctx.fill();

        // Mid warm zone
        const g2 = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        g2.addColorStop(0, "rgba(255,255,255,0.9)");
        g2.addColorStop(0.25, `rgba(245,158,11,${0.6 + conf * 0.3})`);
        g2.addColorStop(0.6, `rgba(239,68,68,${0.3 + conf * 0.2})`);
        g2.addColorStop(1, "rgba(239,68,68,0)");
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

        // Human silhouette (white-hot)
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        // Head
        ctx.beginPath(); ctx.arc(cx, cy - 8, 5, 0, Math.PI * 2); ctx.fill();
        // Torso
        ctx.beginPath(); ctx.ellipse(cx, cy + 5, 7, 11, 0, 0, Math.PI * 2); ctx.fill();
        // Arms (faint)
        ctx.fillStyle = "rgba(255,200,100,0.5)";
        ctx.beginPath(); ctx.ellipse(cx - 10, cy + 3, 3, 7, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + 10, cy + 3, 3, 7, 0.3, 0, Math.PI * 2); ctx.fill();

        // AI target ring
        ctx.strokeStyle = `rgba(220,38,38,${0.5 + conf * 0.4})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);

        // Inner solid ring when confirmed
        if (conf >= 0.85) {
          ctx.strokeStyle = "rgba(220,38,38,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(cx, cy, r - 6, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        // Cool terrain shapes when searching
        ctx.fillStyle = "rgba(56,189,248,0.025)";
        ctx.beginPath();
        ctx.moveTo(0, h - 40);
        ctx.quadraticCurveTo(w * 0.3, h - 110, w * 0.5, h - 65);
        ctx.quadraticCurveTo(w * 0.7, h - 20, w, h - 85);
        ctx.lineTo(w, h); ctx.lineTo(0, h);
        ctx.closePath(); ctx.fill();
      }

      // ── HUD overlay elements
      // Crosshair
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.75;
      const cx2 = w / 2, cy2 = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx2 - 22, cy2); ctx.lineTo(cx2 - 8, cy2);
      ctx.moveTo(cx2 + 8, cy2); ctx.lineTo(cx2 + 22, cy2);
      ctx.moveTo(cx2, cy2 - 22); ctx.lineTo(cx2, cy2 - 8);
      ctx.moveTo(cx2, cy2 + 8); ctx.lineTo(cx2, cy2 + 22);
      ctx.stroke();

      // Corner brackets
      const bl = 16;
      [[10, 10, 1, 1], [w - 10, 10, -1, 1], [10, h - 10, 1, -1], [w - 10, h - 10, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + sy * bl); ctx.lineTo(x, y); ctx.lineTo(x + sx * bl, y);
        ctx.stroke();
      });

      // Scan line sweep
      scanY = (scanY + dt * 55) % h;
      const sg = ctx.createLinearGradient(0, scanY - 3, 0, scanY + 3);
      sg.addColorStop(0, "rgba(56,189,248,0)");
      sg.addColorStop(0.5, "rgba(56,189,248,0.06)");
      sg.addColorStop(1, "rgba(56,189,248,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, scanY - 3, w, 6);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [ms, activeDetection]);

  const S = (v: string | number, fallback = "---") =>
    telemetry.provenance === "STALE" ? fallback : String(v);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
      background: "var(--bg-base)", padding: 8, gap: 8,
    }}>
      {/* Header */}
      <div className="panel" style={{ padding: "8px 12px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Video size={14} style={{ color: "var(--info)" }} />
          <div>
            <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.12em" }}>
              TACTICAL CAMERA WORKSTATION
            </div>
            <div className="mono" style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 1 }}>
              DR-07 · GIMBAL STABILIZED · FLIR THERMAL INFRARED
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {[
            { label: "FEED", val: "ACTIVE", color: "var(--nominal)" },
            { label: "MODE", val: "THERMAL IR", color: "var(--info)" },
            { label: "CODEC", val: "H.265 AVC", color: "var(--text-primary)" },
          ].map(({ label, val, color }) => (
            <div key={label}>
              <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 2 }}>{label}</div>
              <div className="mono" style={{ fontSize: 10, fontWeight: 700, color }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main workspace */}
      <div style={{ flex: 1, display: "flex", gap: 8, minHeight: 0 }}>
        {/* Camera viewport */}
        <div className="panel" style={{
          flex: 1, position: "relative", overflow: "hidden",
          background: "#0c0e12", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0, minWidth: 0,
        }}>
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />

          {/* HUD overlays */}
          <div style={{ position: "absolute", inset: 12, pointerEvents: "none", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            {/* Top */}
            <div style={{
              display: "flex", justifyContent: "space-between",
              background: "linear-gradient(to bottom, rgba(9,10,12,0.7), transparent)",
              padding: "6px 8px", borderRadius: 2,
            }}>
              <div style={{ display: "flex", gap: 14 }}>
                {[
                  ["NODE", `DR-07`],
                  ["FRAME", S(frameCount)],
                  ["SIG", `${S(telemetry.system.signal_dbm)} dBm`],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="mono" style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>{l}</div>
                    <div className="mono" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "right", display: "flex", gap: 14 }}>
                {[
                  ["SYS CLK", currentTime.split("T")[1].slice(0, 12)],
                  ["PITCH", `${S(telemetry.kinematics.pitch.toFixed(1))}°`],
                  ["ROLL", `${S(telemetry.kinematics.roll.toFixed(1))}°`],
                ].map(([l, v]) => (
                  <div key={l} style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>{l}</div>
                    <div className="mono" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI bounding box */}
            {ms !== "SEARCHING" && activeDetection && (
              <div style={{
                position: "absolute",
                width: 130,
                height: 92,
                left: ms === "POSITIONED" || ms === "ARMED" || ms === "EXECUTED" ? "calc(50% - 65px)" : "calc(62% - 65px)",
                top: ms === "POSITIONED" || ms === "ARMED" || ms === "EXECUTED" ? "calc(50% - 46px)" : "calc(62% - 46px)",
                transition: "left 0.5s ease-out, top 0.5s ease-out",
                border: "1px solid rgba(220,38,38,0.7)",
                background: "rgba(220,38,38,0.04)",
              }}>
                {/* Corner brackets */}
                {[["top:0;left:0;border-top:2px solid;border-left:2px solid", ""],
                  ["top:0;right:0;border-top:2px solid;border-right:2px solid", ""],
                  ["bottom:0;left:0;border-bottom:2px solid;border-left:2px solid", ""],
                  ["bottom:0;right:0;border-bottom:2px solid;border-right:2px solid", ""],
                ].map((_, i) => (
                  <div key={i} style={{
                    position: "absolute",
                    width: 10, height: 10,
                    borderColor: "rgba(220,38,38,0.9)",
                    ...(i === 0 ? { top: 0, left: 0, borderTop: "1.5px solid", borderLeft: "1.5px solid" } :
                       i === 1 ? { top: 0, right: 0, borderTop: "1.5px solid", borderRight: "1.5px solid" } :
                       i === 2 ? { bottom: 0, left: 0, borderBottom: "1.5px solid", borderLeft: "1.5px solid" } :
                                 { bottom: 0, right: 0, borderBottom: "1.5px solid", borderRight: "1.5px solid" }),
                  }} />
                ))}
                <div style={{ position: "absolute", top: -14, left: 0, display: "flex", gap: 4, alignItems: "center" }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--critical)", animation: "pulse-slow 0.6s ease-in-out infinite" }} />
                  <span className="mono" style={{ fontSize: 7.5, color: "var(--critical)", fontWeight: 700, letterSpacing: "0.08em" }}>
                    {activeDetection.class.replace("_", " ")}
                  </span>
                </div>
                <div style={{ position: "absolute", bottom: -14, right: 0 }}>
                  <span className="mono" style={{ fontSize: 8.5, color: "var(--nominal)", fontWeight: 700 }}>
                    {(activeDetection.confidence * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}

            {/* Bottom */}
            <div style={{
              display: "flex", justifyContent: "space-between",
              background: "linear-gradient(to top, rgba(9,10,12,0.7), transparent)",
              padding: "6px 8px", borderRadius: 2,
            }}>
              {[
                ["ALT", `${S(telemetry.location.alt_relative.toFixed(1))} m`],
                ["HDG", `${S(telemetry.location.heading.toFixed(1))}°`],
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="mono" style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>{l}</div>
                  <div className="mono" style={{ fontSize: 9.5, color: "rgba(255,255,255,0.9)", fontWeight: 600 }}>{v}</div>
                </div>
              ))}
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>GPS FIX</div>
                <div className="mono" style={{ fontSize: 9.5, color: "rgba(56,189,248,0.9)", fontWeight: 600 }}>{S(telemetry.system.gps_fix)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mono" style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>COORD</div>
                <div className="mono" style={{ fontSize: 8, color: "rgba(255,255,255,0.8)" }}>
                  {S(`${telemetry.location.lat.toFixed(5)}, ${telemetry.location.lng.toFixed(5)}`)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="panel" style={{ width: 190, flexShrink: 0, padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="panel-header">
            <Crosshair size={10} style={{ color: activeDetection ? "var(--critical)" : "var(--text-muted)" }} />
            AI ANALYSIS
          </div>

          {ms !== "SEARCHING" && activeDetection ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "auto" }}>
              <div style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)", borderRadius: 2, padding: "6px 8px" }}>
                <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 3 }}>TARGET PROFILE</div>
                {[
                  ["CODE", "D-042"],
                  ["CLASS", "HUMAN SURVIVOR"],
                  ["VERIFIED", activeDetection.confidence >= 0.85 ? "YES (≥85%)" : "PENDING"],
                  ["HEAT IDX", "342°C PEAK"],
                ].map(([l, v]) => (
                  <div key={l} className="telem-row">
                    <span className="telem-label">{l}</span>
                    <span className="telem-value" style={{ fontSize: 9.5 }}>{v}</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="mono" style={{ fontSize: 7.5, color: "var(--text-muted)", letterSpacing: "0.1em", marginBottom: 6 }}>SIGNAL STRENGTHS</div>
                {[
                  ["THERMAL GRADIENT", activeDetection.confidence >= 0.85 ? 92 : 64],
                  ["MOTION ANALYSIS", activeDetection.confidence >= 0.85 ? 87 : 51],
                  ["SHAPE VECTOR", activeDetection.confidence >= 0.85 ? 81 : 44],
                ].map(({ 0: label, 1: val }) => (
                  <div key={label} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span className="mono" style={{ fontSize: 7.5, color: "var(--text-secondary)" }}>{label}</span>
                      <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: "var(--nominal)" }}>{val}%</span>
                    </div>
                    <div className="confidence-bar-track">
                      <div className="confidence-bar-fill" style={{ width: `${val}%`, background: "var(--nominal)" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 8, border: "1px dashed var(--border-subtle)", borderRadius: 2, padding: 12 }}>
              <Crosshair size={18} style={{ color: "var(--text-muted)", animation: "pulse-slow 2s ease-in-out infinite" }} />
              <span className="mono" style={{ fontSize: 8.5, color: "var(--text-secondary)" }}>NO ACTIVE LOCK</span>
              <p style={{ fontSize: 8, color: "var(--text-muted)", lineHeight: 1.6 }}>Target locks appear here once detection is confirmed.</p>
            </div>
          )}

          <div style={{ flexShrink: 0, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 2, padding: "6px 8px", display: "flex", gap: 6, alignItems: "flex-start" }}>
            <ShieldCheck size={12} style={{ color: "var(--nominal)", flexShrink: 0, marginTop: 1 }} />
            <span className="mono" style={{ fontSize: 7.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              AES-256 encrypted · RTH failsafe active · IMU calibrated
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
