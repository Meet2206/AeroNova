import LiveFeed from '../components/LiveFeed'
import FlightTelemetry from '../components/FlightTelemetry'
import AIDetectionPanel from '../components/AIDetectionPanel'
import TacticalMap from '../components/TacticalMap'
import EventStream from '../components/EventStream'
import { useMission } from '../simulation/MissionContext'

export default function Camera() {
  const { mission } = useMission()
  const aircraft = mission?.aircraft[0]

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F4F1EA' }}>
      {/* Sub-header */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 border-b"
        style={{ background: '#E5DED2', borderColor: '#C8C2B2' }}
      >
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
            LIVE FEED — DR-07 CAM-01
          </span>
          <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>
            OPTICAL · NADIR
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>
          <span>SENSOR: 1/2.3"</span>
          <span>·</span>
          <span>FOV: 84°</span>
          <span>·</span>
          <span>ZOOM: 1×</span>
          <span>·</span>
          <span>LATENCY: {aircraft?.latencyMs ?? 84}ms</span>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* Primary video area */}
        <div className="flex-1 min-w-0 relative border-r" style={{ borderColor: '#C8C2B2' }}>
          <LiveFeed />

          {/* Telemetry overlay at bottom of video */}
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center gap-6 px-4 py-2"
            style={{ background: 'rgba(48,54,42,0.9)', borderTop: '1px solid #4B532060' }}
          >
            {aircraft && (
              <>
                <div className="font-mono text-xs tabular-nums" style={{ color: '#7FA9A6', fontSize: '10px' }}>
                  ALT <span style={{ color: '#E5DED2' }}>{aircraft.altitude.toFixed(1)}m</span>
                </div>
                <div className="font-mono text-xs tabular-nums" style={{ color: '#7FA9A6', fontSize: '10px' }}>
                  SPD <span style={{ color: '#E5DED2' }}>{aircraft.speed.toFixed(1)}m/s</span>
                </div>
                <div className="font-mono text-xs tabular-nums" style={{ color: '#7FA9A6', fontSize: '10px' }}>
                  HDG <span style={{ color: '#E5DED2' }}>{Math.round(aircraft.heading)}°</span>
                </div>
                <div className="font-mono text-xs tabular-nums" style={{ color: '#7FA9A6', fontSize: '10px' }}>
                  GPS <span style={{ color: aircraft.gpsMode === 'RTK FIX' ? '#2D6A4F' : '#B87925' }}>{aircraft.gpsMode}</span>
                </div>
                <div className="font-mono text-xs tabular-nums" style={{ color: '#7FA9A6', fontSize: '10px' }}>
                  BAT <span style={{ color: aircraft.battery > 50 ? '#2D6A4F' : '#B87925' }}>{aircraft.battery.toFixed(0)}%</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-64 shrink-0 flex flex-col overflow-y-auto">
          {/* Mini map */}
          <div className="h-48 shrink-0 border-b" style={{ borderColor: '#E5DED2' }}>
            <div className="h-full relative">
              <TacticalMap compact />
              <div
                className="absolute top-2 left-2 font-mono text-xs"
                style={{ fontSize: '9px', color: '#6B6F63', background: '#F4F1EA90', padding: '2px 4px', borderRadius: '2px' }}
              >
                MAP CONTEXT
              </div>
            </div>
          </div>

          {/* AI panel */}
          <div className="p-3 border-b flex-1" style={{ borderColor: '#E5DED2' }}>
            <AIDetectionPanel />
          </div>

          {/* Events */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
                RECENT EVENTS
              </span>
            </div>
            <EventStream maxItems={10} />
          </div>
        </div>
      </div>
    </div>
  )
}
