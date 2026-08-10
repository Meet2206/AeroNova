import TacticalMap from '../components/TacticalMap'
import AIDetectionPanel from '../components/AIDetectionPanel'
import LiveFeed from '../components/LiveFeed'
import FlightTelemetry from '../components/FlightTelemetry'
import MissionStateTrack from '../components/MissionStateTrack'
import SafetyGate from '../components/SafetyGate'
import EventStream from '../components/EventStream'
import AircraftList from '../components/AircraftList'
import { useMission } from '../simulation/MissionContext'

function MissionBrief() {
  const { mission } = useMission()
  if (!mission) return null

  const priorityColor = mission.priority === 'HIGH' ? '#9B2C2C' : mission.priority === 'MEDIUM' ? '#B87925' : '#4B5320'

  return (
    <div
      className="flex items-center gap-6 px-4 py-2 shrink-0"
      style={{ background: '#E5DED2', borderBottom: '1px solid #C8C2B2' }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono font-bold text-xs tracking-wider" style={{ color: '#20231E', letterSpacing: '0.1em', fontSize: '10px' }}>
          {mission.name}
        </span>
      </div>
      <div className="w-px h-4" style={{ background: '#C8C2B2' }} />
      <div className="flex items-center gap-1.5">
        <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>PRIORITY</span>
        <span className="font-mono font-semibold" style={{ fontSize: '9px', color: priorityColor }}>{mission.priority}</span>
      </div>
      <div className="w-px h-4" style={{ background: '#C8C2B2' }} />
      <div className="flex items-center gap-1.5">
        <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>TYPE</span>
        <span className="font-mono font-medium" style={{ fontSize: '9px', color: '#20231E' }}>{mission.type}</span>
      </div>
      <div className="w-px h-4" style={{ background: '#C8C2B2' }} />
      <div className="flex items-center gap-1.5">
        <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>SECTOR</span>
        <span className="font-mono font-medium" style={{ fontSize: '9px', color: '#20231E' }}>{mission.sector}</span>
      </div>
      <div className="w-px h-4" style={{ background: '#C8C2B2' }} />
      <div className="flex items-center gap-1.5">
        <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>AIRCRAFT</span>
        <span className="font-mono font-medium" style={{ fontSize: '9px', color: '#20231E' }}>
          {mission.aircraft.filter((a) => a.status === 'ACTIVE').length} ACTIVE
        </span>
      </div>
      <div className="w-px h-4" style={{ background: '#C8C2B2' }} />
      <div className="flex items-center gap-1.5">
        <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>DETECTIONS</span>
        <span
          className="font-mono font-semibold"
          style={{ fontSize: '9px', color: mission.activeDetections > 0 ? '#B85C38' : '#6B6F63' }}
        >
          {mission.activeDetections} ACTIVE
        </span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F4F1EA' }}>
      <MissionBrief />

      {/* Main workspace — 3 columns */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — AI + Aircraft */}
        <div
          className="w-64 shrink-0 flex flex-col border-r overflow-y-auto"
          style={{ borderColor: '#C8C2B2', background: '#F4F1EA' }}
        >
          {/* AI Detection */}
          <div className="p-3 border-b" style={{ borderColor: '#E5DED2' }}>
            <AIDetectionPanel />
          </div>

          {/* Aircraft list */}
          <div className="p-3">
            <AircraftList />
          </div>
        </div>

        {/* Center — Map */}
        <div className="flex-1 min-w-0 relative">
          <TacticalMap />
        </div>

        {/* Right panel — Camera + Telemetry */}
        <div
          className="w-60 shrink-0 flex flex-col border-l overflow-y-auto"
          style={{ borderColor: '#C8C2B2', background: '#F4F1EA' }}
        >
          {/* Live feed */}
          <div className="h-44 shrink-0 border-b" style={{ borderColor: '#E5DED2' }}>
            <LiveFeed compact />
          </div>

          {/* Flight telemetry */}
          <div className="p-3 border-b flex-1" style={{ borderColor: '#E5DED2' }}>
            <FlightTelemetry />
          </div>
        </div>
      </div>

      {/* Bottom bar — Mission state + Safety + Events */}
      <div
        className="shrink-0 border-t"
        style={{ background: '#F4F1EA', borderColor: '#C8C2B2' }}
      >
        {/* Mission state track */}
        <div
          className="flex items-center justify-between gap-4 px-4 py-2 border-b"
          style={{ borderColor: '#E5DED2' }}
        >
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
              MISSION
            </span>
          </div>
          <MissionStateTrack />
          {/* Safety gate compact */}
          <div className="shrink-0 w-80">
            <SafetyGate />
          </div>
        </div>

        {/* Event stream */}
        <div className="px-4 py-2" style={{ maxHeight: 120, overflowY: 'auto' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
              EVENT STREAM
            </span>
            <span className="font-mono" style={{ fontSize: '9px', color: '#9B9590' }}>IMMUTABLE LOG</span>
          </div>
          <EventStream maxItems={6} />
        </div>
      </div>
    </div>
  )
}
