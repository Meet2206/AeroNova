import { useMission } from '../simulation/MissionContext'

function TelRow({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1" style={{ borderBottom: '1px solid #E5DED240' }}>
      <span className="font-mono text-xs" style={{ color: '#6B6F63', fontSize: '9px', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span className="font-mono font-medium tabular-nums" style={{ color: color ?? '#20231E', fontSize: '11px' }}>
        {value}
        {unit && <span style={{ color: '#6B6F63', fontSize: '9px', marginLeft: '2px' }}>{unit}</span>}
      </span>
    </div>
  )
}

export default function FlightTelemetry() {
  const { mission } = useMission()
  const a = mission?.aircraft[0]
  if (!a) return null

  const battColor = a.battery > 50 ? '#2D6A4F' : a.battery > 25 ? '#B87925' : '#9B2C2C'
  const signalColor = a.signalDbm > -80 ? '#2D6A4F' : a.signalDbm > -95 ? '#B87925' : '#9B2C2C'
  const latColor = a.latencyMs < 100 ? '#2D6A4F' : a.latencyMs < 150 ? '#B87925' : '#9B2C2C'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
          FLIGHT DATA
        </span>
        <span className="font-mono text-xs" style={{ color: '#2D6A4F', fontSize: '9px' }}>DR-07</span>
      </div>

      <div className="flex flex-col">
        <TelRow label="ALTITUDE AGL" value={a.altitude.toFixed(2)} unit="m" />
        <TelRow label="RELATIVE ALT" value={a.altitudeRelative.toFixed(2)} unit="m" />
        <TelRow label="GROUNDSPEED" value={a.speed.toFixed(2)} unit="m/s" />
        <TelRow label="VERTICAL" value={`${a.verticalSpeed >= 0 ? '+' : ''}${a.verticalSpeed.toFixed(2)}`} unit="m/s" color={Math.abs(a.verticalSpeed) > 3 ? '#B87925' : undefined} />
        <TelRow label="HEADING" value={`${a.heading.toFixed(1)}°`} />
      </div>

      <div className="mt-2 flex items-center justify-between mb-1">
        <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
          SYSTEMS
        </span>
      </div>

      <div className="flex flex-col">
        <TelRow label="GPS MODE" value={a.gpsMode} color={a.gpsMode === 'RTK FIX' ? '#2D6A4F' : a.gpsMode === 'RTK FLOAT' ? '#B87925' : '#9B2C2C'} />
        <TelRow label="SATELLITES" value={a.satellites.toString()} />
        <TelRow label="SIGNAL" value={`${a.signalDbm}`} unit="dBm" color={signalColor} />
        <TelRow label="BATTERY" value={`${a.battery.toFixed(0)}`} unit="%" color={battColor} />
        <TelRow label="LATENCY" value={`${a.latencyMs}`} unit="ms" color={latColor} />
      </div>
    </div>
  )
}
