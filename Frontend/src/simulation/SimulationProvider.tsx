import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import type { TelemetryPacket } from "../types/telemetry";
import type { AIDetectionPacket } from "../types/detection";
import type { MissionEvent } from "../types/event";

interface SimulationContextType {
  telemetry: TelemetryPacket;
  activeDetection: AIDetectionPacket | null;
  confidenceHistory: number[];
  events: MissionEvent[];
  scenario: string;
  setScenario: (s: string) => void;
  armSystem: () => void;
  disarmSystem: () => void;
  executeAction: () => void;
  dismissDetection: () => void;
  resetMission: () => void;
  gpsLossTriggered: boolean;
  gpsFlashActive: boolean;
  exportEventsJson: () => void;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

// ── Constants ──────────────────────────────────────────────────────────────────
const HOME_LAT = 37.7749;
const HOME_LNG = -122.4194;
const TARGET_LAT = 37.7782;
const TARGET_LNG = -122.4158;
const MDEG_LAT = 111320;
const MDEG_LNG = 111320 * Math.cos(HOME_LAT * (Math.PI / 180));

const INIT_EVENTS: MissionEvent[] = [
  { id: "e0", timestamp: Date.now() - 12000, type: "SYSTEM",    source: "SYSTEM",   message: "AERONOVA CORE SYSTEM ONLINE — BUILD V1.0.0" },
  { id: "e1", timestamp: Date.now() - 10000, type: "TELEMETRY", source: "SYSTEM",   message: "MAVLINK TRANSLATION LAYER ACTIVE — PROVENANCE: SIMULATED" },
  { id: "e2", timestamp: Date.now() - 8000,  type: "SYSTEM",    source: "DR-07",    message: "PRE-FLIGHT DIAGNOSTICS: ALL SENSORS NOMINAL — RTK FIXED" },
  { id: "e3", timestamp: Date.now() - 6000,  type: "MISSION",   source: "MISSION",  message: "MISSION CONFIGURATION LOADED: RESCUE-042 — SEARCH & RESCUE" },
  { id: "e4", timestamp: Date.now() - 4000,  type: "MISSION",   source: "DR-07",    message: "ORBITAL SEARCH PATTERN INITIATED AT [37.7749° N, 122.4194° W]" },
];

// ── Utility ──────────────────────────────────────────────────────────────────
function makeId() { return `evt-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ── Provider ─────────────────────────────────────────────────────────────────
export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ── Scenario / overrides
  const [scenario, setScenarioState] = useState("NORMAL");
  const scenarioRef = useRef("NORMAL");

  // ── GPS loss flash
  const [gpsLossTriggered, setGpsLossTriggered] = useState(false);
  const [gpsFlashActive, setGpsFlashActive] = useState(false);

  // ── Events (immutable append-only)
  const [events, setEvents] = useState<MissionEvent[]>(INIT_EVENTS);
  const addEvent = useCallback((type: MissionEvent["type"], source: string, message: string) => {
    setEvents(prev => [...prev, { id: makeId(), timestamp: Date.now(), type, source, message }]);
  }, []);

  // ── Mission state machine
  const [missionState, setMissionState] = useState<TelemetryPacket["mission_state"]>("SEARCHING");
  const missionStateRef = useRef<TelemetryPacket["mission_state"]>("SEARCHING");
  const updateMissionState = useCallback((next: TelemetryPacket["mission_state"]) => {
    missionStateRef.current = next;
    setMissionState(next);
  }, []);

  // ── Drone location (ref for tick loop, state for render)
  const [droneLocation, setDroneLocation] = useState({
    lat: HOME_LAT, lng: HOME_LNG,
    alt_msl: 150.8, alt_relative: 120.5, heading: 0,
  });
  const droneLocationRef = useRef({ lat: HOME_LAT, lng: HOME_LNG, alt_msl: 150.8, alt_relative: 120.5, heading: 0 });

  // ── Kinematics
  const [kinematics, setKinematics] = useState({ vx: 12.0, vy: 0.0, vz: 0.0, pitch: 2.1, roll: -3.5, yaw: 0.0 });
  const kinematicsRef = useRef({ vx: 12.0, vy: 0.0, vz: 0.0, pitch: 2.1, roll: -3.5, yaw: 0.0 });

  // ── System health
  const [sysHealth, setSysHealth] = useState({
    battery_pct: 78.5,
    gps_fix: "RTK_FIXED" as TelemetryPacket["system"]["gps_fix"],
    satellites: 18,
    signal_dbm: -64,
  });
  const sysHealthRef = useRef({ battery_pct: 78.5, gps_fix: "RTK_FIXED" as TelemetryPacket["system"]["gps_fix"], satellites: 18, signal_dbm: -64 });

  // ── AI detection
  const [activeDetection, setActiveDetection] = useState<AIDetectionPacket | null>(null);
  const activeDetectionRef = useRef<AIDetectionPacket | null>(null);
  const [confidenceHistory, setConfidenceHistory] = useState<number[]>([]);

  // ── Simulation internals (refs only — not rendered)
  const orbitAngle = useRef(0);
  const scenarioTimer = useRef(0);
  const lastTick = useRef(Date.now());
  const detectionInitialized = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────────
  // Operator actions
  // ─────────────────────────────────────────────────────────────────────────────
  const armSystem = useCallback(() => {
    const ms = missionStateRef.current;
    const sc = scenarioRef.current;
    const gh = sysHealthRef.current;
    if (ms !== "POSITIONED") { addEvent("ERROR", "SAFETY", "ARMING DENIED: SYSTEM NOT POSITIONED"); return; }
    if (sc === "STALE") { addEvent("ERROR", "SAFETY", "ARMING DENIED: TELEMETRY STALE"); return; }
    if (gh.gps_fix === "NO_FIX" || sc === "GPS_LOSS") { addEvent("ERROR", "SAFETY", "ARMING DENIED: GPS FIX REQUIRED"); return; }
    updateMissionState("ARMED");
    addEvent("SAFETY",   "OPERATOR", "SAFETY GATE SLIDE-TO-ARM COMPLETED — SYSTEM ARMED");
  }, [addEvent, updateMissionState]);

  const disarmSystem = useCallback(() => {
    if (missionStateRef.current === "ARMED") {
      updateMissionState("POSITIONED");
      addEvent("SAFETY", "OPERATOR", "SYSTEM MANUALLY DISARMED BY OPERATOR");
    }
  }, [addEvent, updateMissionState]);

  const executeAction = useCallback(() => {
    if (missionStateRef.current !== "ARMED") { addEvent("ERROR", "SAFETY", "EXECUTION DENIED: SYSTEM NOT ARMED"); return; }
    updateMissionState("EXECUTED");
    addEvent("OPERATOR", "OPERATOR",  "CONSEQUENTIAL ACTION AUTHORIZED — PAYLOAD DISPENSE TRIGGERED");
    addEvent("MISSION",  "DR-07",     "DISASTER RESPONSE PAYLOAD RELEASED SUCCESSFULLY");
    addEvent("MISSION",  "DR-07",     "ENTERING AUTONOMOUS RETURN-TO-HOME PATTERN");
  }, [addEvent, updateMissionState]);

  const dismissDetection = useCallback(() => {
    const det = activeDetectionRef.current;
    if (!det) return;
    addEvent("OPERATOR", "OPERATOR", `DETECTION DISMISSED BY OPERATOR — ID: ${det.detection_id.toUpperCase()}`);
    addEvent("MISSION",  "MISSION",  "STATE -> SEARCHING (DETECTION DISMISSED)");
    activeDetectionRef.current = null;
    setActiveDetection(null);
    setConfidenceHistory([]);
    detectionInitialized.current = false;
    scenarioTimer.current = 0;
    if (scenarioRef.current === "DETECTION") { scenarioRef.current = "NORMAL"; setScenarioState("NORMAL"); }
    updateMissionState("SEARCHING");
  }, [addEvent, updateMissionState]);

  const resetMission = useCallback(() => {
    scenarioRef.current = "NORMAL"; setScenarioState("NORMAL");
    setGpsLossTriggered(false); setGpsFlashActive(false);
    const initLoc = { lat: HOME_LAT, lng: HOME_LNG, alt_msl: 150.8, alt_relative: 120.5, heading: 0 };
    droneLocationRef.current = initLoc; setDroneLocation(initLoc);
    const initKin = { vx: 12.0, vy: 0.0, vz: 0.0, pitch: 2.1, roll: -3.5, yaw: 0.0 };
    kinematicsRef.current = initKin; setKinematics(initKin);
    const initSys = { battery_pct: 78.5, gps_fix: "RTK_FIXED" as const, satellites: 18, signal_dbm: -64 };
    sysHealthRef.current = initSys; setSysHealth(initSys);
    activeDetectionRef.current = null; setActiveDetection(null);
    setConfidenceHistory([]);
    detectionInitialized.current = false;
    scenarioTimer.current = 0; orbitAngle.current = 0;
    updateMissionState("SEARCHING");
    addEvent("SYSTEM", "OPERATOR", "MISSION RESET — RETURNING TO INITIAL STATE: SEARCHING");
  }, [addEvent, updateMissionState]);

  const setScenario = useCallback((sc: string) => {
    scenarioRef.current = sc;
    setScenarioState(sc);
    addEvent("SYSTEM", "OPERATOR", `DEVELOPER SIM SCENARIO OVERRIDDEN: ${sc}`);

    if (sc === "GPS_LOSS") {
      setGpsLossTriggered(true);
      setGpsFlashActive(true);
      const next = { ...sysHealthRef.current, gps_fix: "NO_FIX" as const, satellites: 0 };
      sysHealthRef.current = next; setSysHealth(next);
      addEvent("ERROR",   "TELEMETRY", "GPS FIX LOST — ERROR 0x4F (NO_FIX)");
      addEvent("WARNING", "SAFETY",    "SAFETY GATES SUSPENDED — GPS POSITIONING REQUIRED");
      setTimeout(() => setGpsFlashActive(false), 900);
      // Disarm if armed
      if (missionStateRef.current === "ARMED") {
        updateMissionState("POSITIONED");
        addEvent("SAFETY", "SAFETY", "EMERGENCY DISARM — GPS LOSS DETECTED");
      }
    } else if (sc === "NORMAL") {
      setGpsLossTriggered(false); setGpsFlashActive(false);
      const next = { ...sysHealthRef.current, gps_fix: "RTK_FIXED" as const, satellites: 18, signal_dbm: -64 };
      sysHealthRef.current = next; setSysHealth(next);
    } else if (sc === "SIGNAL_LOSS") {
      const next = { ...sysHealthRef.current, signal_dbm: -92 };
      sysHealthRef.current = next; setSysHealth(next);
      addEvent("WARNING", "TELEMETRY", "RADIO LINK DEGRADED — SIGNAL: -92 dBm (CRITICAL THRESHOLD)");
    } else if (sc === "LOW_BATTERY") {
      const next = { ...sysHealthRef.current, battery_pct: 12.4 };
      sysHealthRef.current = next; setSysHealth(next);
      addEvent("WARNING", "SYSTEM", "LOW BATTERY ALERT — 12.4% REMAINING — RTH RECOMMENDED");
    } else if (sc === "STALE") {
      addEvent("ERROR", "TELEMETRY", "HEARTBEAT LOST — ENTERING STALE SAFE STATE — ALL COMMANDS SUSPENDED");
    }
  }, [addEvent, updateMissionState]);

  const exportEventsJson = useCallback(() => {
    setEvents(current => {
      const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `aeronova_mission_log_${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return current;
    });
    addEvent("SYSTEM", "OPERATOR", "MISSION EVENT LOG EXPORTED TO JSON FILE");
  }, [addEvent]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 10 Hz simulation tick
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const sc = scenarioRef.current;
      if (sc === "STALE") return; // Halt all updates when stale

      const now = Date.now();
      const dt = Math.min((now - lastTick.current) / 1000, 0.2); // cap dt to 200ms
      lastTick.current = now;
      scenarioTimer.current += dt;

      // ── 1. Battery drain (very slow)
      const newBatt = Math.max(0, sysHealthRef.current.battery_pct - dt * 0.025);
      // ── 2. Signal fluctuations
      let newSig = sysHealthRef.current.signal_dbm;
      if (sc !== "SIGNAL_LOSS") {
        newSig = Math.round(Math.min(-48, Math.max(-88, newSig + (Math.random() - 0.5) * 2)));
      }
      const nextSys = { ...sysHealthRef.current, battery_pct: newBatt, signal_dbm: newSig };
      sysHealthRef.current = nextSys;
      setSysHealth({ ...nextSys });

      // ── 3. Auto-trigger AI detection after 6s in NORMAL
      const ms = missionStateRef.current;
      if (sc === "NORMAL" && scenarioTimer.current > 6.0 && !activeDetectionRef.current && ms === "SEARCHING") {
        scenarioRef.current = "DETECTION"; setScenarioState("DETECTION");
        scenarioTimer.current = 0;
      }

      // ── 4. Detection lifecycle
      if (sc === "DETECTION" || scenarioRef.current === "DETECTION") {
        if (!detectionInitialized.current) {
          const det: AIDetectionPacket = {
            detection_id: "det-042",
            timestamp: Date.now(),
            class: "HUMAN_SURVIVOR",
            confidence: 0.55,
            bounding_box: [0.42, 0.38, 0.15, 0.22],
            geolocation: { lat: TARGET_LAT, lng: TARGET_LNG },
            reasoning_triggers: ["THERMAL_SIGNATURE", "MOTION_VECTOR"],
          };
          activeDetectionRef.current = det;
          setActiveDetection(det);
          setConfidenceHistory([0.55]);
          detectionInitialized.current = true;
          updateMissionState("DETECTED");
          addEvent("AI",      "AI_INFERENCE", "POTENTIAL TARGET DETECTED — CLASS: HUMAN_SURVIVOR — ID: D-042");
          addEvent("MISSION", "MISSION",      "STATE -> DETECTED");
        } else if (activeDetectionRef.current) {
          const prev = activeDetectionRef.current;
          const newConf = Math.min(0.914, prev.confidence + dt * 0.09);
          const updated = { ...prev, confidence: newConf };
          activeDetectionRef.current = updated;
          setActiveDetection({ ...updated });
          setConfidenceHistory(h => {
            const next = [...h, newConf];
            return next.slice(-30);
          });

          // Trigger CONFIRMED at 85%
          if (prev.confidence < 0.85 && newConf >= 0.85 && missionStateRef.current === "DETECTED") {
            updateMissionState("CONFIRMED");
            addEvent("AI",      "AI_INFERENCE", `TARGET LOCK ACQUIRED — CONFIDENCE: ${(newConf * 100).toFixed(1)}% (>85% THRESHOLD)`);
            addEvent("AI",      "AI_INFERENCE", "EVIDENCE: THERMAL 92% · MOTION 87% · SHAPE 81% — ALL SIGNALS POSITIVE");
            addEvent("MISSION", "MISSION",      "STATE -> CONFIRMED");
          }
        }
      } else if (ms !== "SEARCHING" && !activeDetectionRef.current) {
        // Reset if detection was cleared
      }

      // ── 5. Drone kinematics
      const dl = droneLocationRef.current;

      if (ms === "SEARCHING") {
        orbitAngle.current += dt * 0.18;
        const r = 0.0007;
        const nextLat = HOME_LAT + r * Math.cos(orbitAngle.current);
        const nextLng = HOME_LNG + r * Math.sin(orbitAngle.current);
        const hdg = ((orbitAngle.current * 180 / Math.PI + 90) % 360 + 360) % 360;
        const vert = Math.sin(orbitAngle.current * 3) * 0.6;

        const nextLoc = { lat: nextLat, lng: nextLng, alt_relative: 120.5 + vert, alt_msl: 135.8 + vert, heading: hdg };
        droneLocationRef.current = nextLoc; setDroneLocation({ ...nextLoc });

        const nextKin = { vx: 13.2, vy: 0.3, vz: vert * 0.5, pitch: 2.4, roll: -5.5, yaw: hdg };
        kinematicsRef.current = nextKin; setKinematics({ ...nextKin });

      } else if (ms === "DETECTED" || ms === "CONFIRMED") {
        const det = activeDetectionRef.current;
        if (!det) return;
        const dLat = det.geolocation.lat - dl.lat;
        const dLng = det.geolocation.lng - dl.lng;
        const dy = dLat * MDEG_LAT;
        const dx = dLng * MDEG_LNG;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hdg = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;

        if (dist > 6) {
          const speed = 15;
          const ratio = Math.min(1, (speed * dt) / dist);
          const nextLat = dl.lat + dLat * ratio;
          const nextLng = dl.lng + dLng * ratio;
          const altDrop = -3.0;

          const nextLoc = { lat: nextLat, lng: nextLng, alt_relative: Math.max(88, dl.alt_relative + altDrop * dt), alt_msl: Math.max(103, dl.alt_msl + altDrop * dt), heading: hdg };
          droneLocationRef.current = nextLoc; setDroneLocation({ ...nextLoc });

          const nextKin = { vx: speed, vy: 0, vz: altDrop, pitch: 5.5, roll: 0.5, yaw: hdg };
          kinematicsRef.current = nextKin; setKinematics({ ...nextKin });
        } else {
          // Reached target → POSITIONED
          if (missionStateRef.current !== "POSITIONED" && missionStateRef.current !== "ARMED" && missionStateRef.current !== "EXECUTED") {
            updateMissionState("POSITIONED");
            addEvent("MISSION", "DR-07",    "TARGET POSITION REACHED — STATION KEEPING ACTIVE");
            addEvent("MISSION", "MISSION",  "STATE -> POSITIONED");
            addEvent("SAFETY",  "SAFETY",   "SAFETY RELEASE GATE UNLOCKED — SLIDE TO ARM AVAILABLE");
          }
        }

      } else if (ms === "POSITIONED" || ms === "ARMED" || ms === "EXECUTED") {
        const det = activeDetectionRef.current;
        const hLat = det ? det.geolocation.lat : TARGET_LAT;
        const hLng = det ? det.geolocation.lng : TARGET_LNG;
        const t = scenarioTimer.current;
        const hoverDrift = 0.000004;

        const nextLoc = {
          lat: hLat + Math.sin(t * 2.1) * hoverDrift,
          lng: hLng + Math.cos(t * 1.7) * hoverDrift,
          alt_relative: 88.0 + Math.sin(t * 3) * 0.2,
          alt_msl: 103.3 + Math.sin(t * 3) * 0.2,
          heading: dl.heading,
        };
        droneLocationRef.current = nextLoc; setDroneLocation({ ...nextLoc });

        const nextKin = { vx: Math.sin(t * 2.1) * 0.2, vy: Math.cos(t * 1.7) * 0.2, vz: Math.sin(t * 3) * 0.1, pitch: Math.sin(t * 2.1) * 0.3, roll: Math.cos(t * 1.7) * 0.4, yaw: dl.heading };
        kinematicsRef.current = nextKin; setKinematics({ ...nextKin });
      }
    };

    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [addEvent, updateMissionState]);

  // ── Derive provenance
  const provenance: TelemetryPacket["provenance"] = scenarioRef.current === "STALE" ? "STALE" : "SIMULATED";

  const telemetry: TelemetryPacket = {
    timestamp: Date.now(),
    drone_id: "DR-07",
    provenance,
    location: { ...droneLocation, alt_msl: droneLocation.alt_relative + 15.3 },
    kinematics,
    system: {
      ...sysHealth,
      gps_fix: scenario === "GPS_LOSS" ? "NO_FIX" : sysHealth.gps_fix,
    },
    mission_state: missionState,
  };

  return (
    <SimulationContext.Provider value={{
      telemetry, activeDetection, confidenceHistory, events,
      scenario, setScenario,
      armSystem, disarmSystem, executeAction, dismissDetection, resetMission,
      gpsLossTriggered, gpsFlashActive, exportEventsJson,
    }}>
      {children}
    </SimulationContext.Provider>
  );
};

export const useSimulation = (): SimulationContextType => {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider");
  return ctx;
};
