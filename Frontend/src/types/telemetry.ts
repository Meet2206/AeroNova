export interface TelemetryPacket {
  timestamp: number;
  drone_id: string;

  provenance: "LIVE" | "SIMULATED" | "STALE";

  location: {
    lat: number;
    lng: number;
    alt_msl: number;
    alt_relative: number;
    heading: number;
  };

  kinematics: {
    vx: number;
    vy: number;
    vz: number;
    pitch: number;
    roll: number;
    yaw: number;
  };

  system: {
    battery_pct: number;
    gps_fix: "NO_FIX" | "2D_FIX" | "3D_FIX" | "RTK_FLOAT" | "RTK_FIXED";
    satellites: number;
    signal_dbm: number;
  };

  mission_state:
    | "SEARCHING"
    | "DETECTED"
    | "CONFIRMED"
    | "POSITIONED"
    | "ARMED"
    | "EXECUTED";
}
