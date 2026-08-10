export type MissionPhase =
  | 'SEARCHING'
  | 'DETECTED'
  | 'CONFIRMED'
  | 'POSITIONED'
  | 'ARMED'
  | 'EXECUTED'

export type DataProvenance = 'LIVE' | 'SIMULATED' | 'STALE'

export interface DroneState {
  id: string
  lat: number
  lng: number
  altitude: number
  altitudeRelative: number
  speed: number
  verticalSpeed: number
  heading: number
  battery: number
  satellites: number
  signalDbm: number
  latencyMs: number
  gpsMode: 'RTK FLOAT' | 'RTK FIX' | 'GPS' | 'LOSS'
  status: 'ACTIVE' | 'STANDBY' | 'OFFLINE'
}

export interface TargetDetection {
  id: string
  lat: number
  lng: number
  confidence: number
  thermal: number
  motion: number
  shape: number
  locked: boolean
  positiveSignals: number
  totalSignals: number
}

export interface MissionState {
  id: string
  name: string
  sector: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  type: string
  phase: MissionPhase
  provenance: DataProvenance
  startTime: Date
  activeDetections: number
  aircraft: DroneState[]
  detection: TargetDetection | null
  confidenceHistory: { t: number; v: number }[]
  safetyGateAuthorized: boolean
  executionAuthorized: boolean
}

export interface EventLog {
  id: string
  timestamp: Date
  source: 'SYSTEM' | 'DR-07' | 'AI' | 'MISSION' | 'OPERATOR'
  message: string
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// Base coordinates: Rann of Kutch / Gujarat disaster scenario
const BASE_LAT = 23.8744
const BASE_LNG = 70.9342
const TARGET_LAT = 23.8801
const TARGET_LNG = 70.9401

export function createInitialState(): MissionState {
  return {
    id: 'RESCUE-042',
    name: 'RESCUE-042',
    sector: 'SECTOR 04 / GUJARAT',
    priority: 'HIGH',
    type: 'SEARCH & RESCUE',
    phase: 'SEARCHING',
    provenance: 'SIMULATED',
    startTime: new Date(),
    activeDetections: 0,
    aircraft: [
      {
        id: 'DR-07',
        lat: BASE_LAT,
        lng: BASE_LNG,
        altitude: 184.3,
        altitudeRelative: 126.1,
        speed: 12.4,
        verticalSpeed: -0.4,
        heading: 284,
        battery: 78,
        satellites: 17,
        signalDbm: -67,
        latencyMs: 84,
        gpsMode: 'RTK FLOAT',
        status: 'ACTIVE',
      },
      {
        id: 'DR-08',
        lat: BASE_LAT - 0.01,
        lng: BASE_LNG + 0.02,
        altitude: 0,
        altitudeRelative: 0,
        speed: 0,
        verticalSpeed: 0,
        heading: 0,
        battery: 94,
        satellites: 0,
        signalDbm: -82,
        latencyMs: 0,
        gpsMode: 'GPS',
        status: 'STANDBY',
      },
      {
        id: 'DR-09',
        lat: BASE_LAT + 0.02,
        lng: BASE_LNG - 0.01,
        altitude: 0,
        altitudeRelative: 0,
        speed: 0,
        verticalSpeed: 0,
        heading: 0,
        battery: 0,
        satellites: 0,
        signalDbm: -110,
        latencyMs: 0,
        gpsMode: 'LOSS',
        status: 'OFFLINE',
      },
    ],
    detection: null,
    confidenceHistory: [],
    safetyGateAuthorized: false,
    executionAuthorized: false,
  }
}

export class MissionSimulator {
  private state: MissionState
  private tick = 0
  private phaseStartTick = 0
  private listeners: Array<(s: MissionState, events: EventLog[]) => void> = []
  private pendingEvents: EventLog[] = []
  private intervalId: ReturnType<typeof setInterval> | null = null
  private frameCount = 0

  constructor() {
    this.state = createInitialState()
    this.emit('SYSTEM', 'AERONOVA MISSION CONTROL ONLINE')
    this.emit('SYSTEM', 'TELEMETRY STREAM ACTIVE — SIMULATED MODE')
    this.emit('DR-07', 'AIRCRAFT AIRBORNE — ALTITUDE 184.3m')
    this.emit('DR-07', 'SEARCH PATTERN ACTIVE — SECTOR 04')
    this.emit('MISSION', `MISSION ${this.state.name} PHASE: SEARCHING`)
  }

  private emit(source: EventLog['source'], message: string) {
    this.pendingEvents.push({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      source,
      message,
    })
  }

  subscribe(cb: (s: MissionState, events: EventLog[]) => void) {
    this.listeners.push(cb)
    cb({ ...this.state }, [])
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private notify() {
    const s = { ...this.state, aircraft: [...this.state.aircraft] }
    const events = [...this.pendingEvents]
    this.pendingEvents = []
    this.listeners.forEach((l) => l(s, events))
  }

  start() {
    this.intervalId = setInterval(() => this.step(), 500)
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
  }

  authorizePositioning() {
    if (this.state.phase !== 'POSITIONED') return
    this.state = { ...this.state, safetyGateAuthorized: true, phase: 'ARMED' }
    this.emit('OPERATOR', 'SAFETY GATE AUTHORIZED — SLIDE CONFIRMED')
    this.emit('MISSION', 'STATE → ARMED')
    this.emit('SYSTEM', '⚠ SYSTEM ARMED — AWAITING FINAL AUTHORIZATION')
    this.notify()
  }

  authorizeExecution() {
    if (this.state.phase !== 'ARMED') return
    this.state = { ...this.state, executionAuthorized: true, phase: 'EXECUTED' }
    this.emit('OPERATOR', 'EXECUTION AUTHORIZED')
    this.emit('MISSION', 'STATE → EXECUTED')
    this.emit('DR-07', 'EXECUTING FINAL APPROACH')
    this.notify()
  }

  cancelArmed() {
    if (this.state.phase !== 'ARMED') return
    this.state = { ...this.state, safetyGateAuthorized: false, phase: 'POSITIONED' }
    this.emit('OPERATOR', 'ARMED STATE CANCELLED — RETURNED TO POSITIONED')
    this.emit('MISSION', 'STATE → POSITIONED')
    this.notify()
  }

  private step() {
    this.tick++
    this.frameCount++
    const elapsed = this.tick - this.phaseStartTick

    const aircraft = this.state.aircraft.map((a, i) => {
      if (i !== 0 || a.status !== 'ACTIVE') return a

      let { lat, lng, heading, speed, altitude, altitudeRelative, verticalSpeed, battery, latencyMs } = a

      const phase = this.state.phase

      if (phase === 'SEARCHING') {
        // Lawnmower search pattern
        heading = 260 + 30 * Math.sin(this.tick * 0.08)
        lat += (Math.sin(this.tick * 0.04) * 0.00003)
        lng += 0.00004
        speed = 11 + 2 * Math.sin(this.tick * 0.1)
        altitude = 184 + 3 * Math.sin(this.tick * 0.06)
      } else if (phase === 'DETECTED' || phase === 'CONFIRMED') {
        // Turning toward target
        const dlat = TARGET_LAT - lat
        const dlng = TARGET_LNG - lng
        const dist = Math.sqrt(dlat * dlat + dlng * dlng)
        const targetHeading = (Math.atan2(dlng, dlat) * 180) / Math.PI
        heading = lerp(heading, targetHeading < 0 ? targetHeading + 360 : targetHeading, 0.12)
        const step = Math.min(dist, 0.0002)
        lat += (dlat / dist) * step
        lng += (dlng / dist) * step
        speed = 14 + 1.5 * Math.sin(this.tick * 0.12)
        altitude = lerp(altitude, 160, 0.04)
      } else if (phase === 'POSITIONED') {
        // Hovering over target
        lat = lerp(lat, TARGET_LAT, 0.08)
        lng = lerp(lng, TARGET_LNG, 0.08)
        speed = 0.4 + 0.3 * Math.sin(this.tick * 0.2)
        altitude = lerp(altitude, 42, 0.06)
        verticalSpeed = -0.8
        heading = 180 + 10 * Math.sin(this.tick * 0.15)
      } else if (phase === 'ARMED' || phase === 'EXECUTED') {
        lat = TARGET_LAT
        lng = TARGET_LNG
        speed = 0
        altitude = 38
        verticalSpeed = 0
        heading = 180
      }

      altitudeRelative = altitude - 58
      verticalSpeed = (altitude - a.altitude) * 2
      battery = Math.max(0, a.battery - 0.02)
      latencyMs = 78 + Math.round(Math.sin(this.tick * 0.3) * 12)

      return { ...a, lat, lng, heading, speed, altitude, altitudeRelative, verticalSpeed, battery, latencyMs }
    })

    let detection = this.state.detection
    let confidenceHistory = this.state.confidenceHistory
    let { phase, activeDetections } = this.state

    // Mission phase transitions
    if (phase === 'SEARCHING' && elapsed > 20) {
      phase = 'DETECTED'
      this.phaseStartTick = this.tick
      activeDetections = 1
      detection = {
        id: 'TGT-001',
        lat: TARGET_LAT,
        lng: TARGET_LNG,
        confidence: 61,
        thermal: 62,
        motion: 58,
        shape: 54,
        locked: false,
        positiveSignals: 1,
        totalSignals: 3,
      }
      this.emit('AI', 'TARGET DETECTED — HUMAN SURVIVOR')
      this.emit('AI', 'INITIAL CONFIDENCE 61.2%')
      this.emit('MISSION', 'STATE → DETECTED')
    }

    if (phase === 'DETECTED' && detection) {
      // Ramp up confidence
      const rampT = Math.min(elapsed / 14, 1)
      detection = {
        ...detection,
        confidence: lerp(61, 91.4, rampT),
        thermal: lerp(62, 92, rampT),
        motion: lerp(58, 87, rampT),
        shape: lerp(54, 81, rampT),
        positiveSignals: rampT > 0.5 ? 2 : 1,
      }
      confidenceHistory = [
        ...confidenceHistory,
        { t: this.tick, v: detection.confidence },
      ].slice(-20)

      if (detection.confidence >= 85 && !detection.locked) {
        detection = { ...detection, locked: true, positiveSignals: 3 }
        this.emit('AI', `CONFIDENCE ${detection.confidence.toFixed(1)}% — TARGET LOCK`)
        this.emit('MISSION', 'STATE → CONFIRMED')
        phase = 'CONFIRMED'
        this.phaseStartTick = this.tick
      }
    }

    if (phase === 'CONFIRMED' && detection) {
      detection = { ...detection, confidence: 91.4, thermal: 92, motion: 87, shape: 81, positiveSignals: 3, totalSignals: 3 }
      confidenceHistory = [...confidenceHistory, { t: this.tick, v: 91.4 }].slice(-20)

      // Check if aircraft has reached target position
      const a = aircraft[0]
      const dlat = TARGET_LAT - a.lat
      const dlng = TARGET_LNG - a.lng
      const dist = Math.sqrt(dlat * dlat + dlng * dlng)
      if (dist < 0.0004 && elapsed > 8) {
        phase = 'POSITIONED'
        this.phaseStartTick = this.tick
        this.emit('DR-07', 'TARGET POSITION REACHED')
        this.emit('MISSION', 'STATE → POSITIONED')
        this.emit('SYSTEM', 'SAFETY GATE UNLOCKED — OPERATOR AUTHORIZATION REQUIRED')
      }
    }

    this.state = {
      ...this.state,
      aircraft,
      detection,
      confidenceHistory,
      phase,
      activeDetections,
    }

    this.notify()
  }
}
