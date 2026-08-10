export interface MissionEvent {
  id: string;
  timestamp: number;
  type:
    | "SYSTEM"
    | "TELEMETRY"
    | "AI"
    | "MISSION"
    | "SAFETY"
    | "OPERATOR"
    | "WARNING"
    | "ERROR";
  source: string;
  message: string;
  metadata?: any;
}
