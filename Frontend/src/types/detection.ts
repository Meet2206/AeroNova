export interface AIDetectionPacket {
  detection_id: string;
  timestamp: number;

  class: "HUMAN_SURVIVOR" | "THERMAL_ANOMALY" | "HAZARD" | "VEHICLE";

  confidence: number;

  bounding_box: [number, number, number, number]; // [x, y, w, h] normalized bounding box

  geolocation: {
    lat: number;
    lng: number;
  };

  reasoning_triggers: Array<
    | "THERMAL_SIGNATURE"
    | "MOTION_VECTOR"
    | "SHAPE_CLASSIFICATION"
  >;
}
