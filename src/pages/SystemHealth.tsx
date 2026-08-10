import { useMission } from '../simulation/MissionContext'

type HealthStatus = 'NOMINAL' | 'DEGRADED' | 'FAULT' | 'OFFLINE' | string

function statusColor(s: HealthStatus) {
  if (s === 'NOMINAL' || s === 'RTK FIX' || s === 'CLEAR') return '#2D6A4F'
  if (s === 'RTK FLOAT' || s === 'DEGRADED') return '#B87925'
  if (s === 'FAULT' || s === 'OFFLINE' || s === 'LOSS') return '#9B2C2C'
  return '#6B6F63'
}

function statusBg(s: HealthStatus) {
  if (s === 'NOMINAL' || s === 'RTK FIX' || s === 'CLEAR') return '#2D6A4F15'
  if (s === 'RTK FLOAT' || s === 'DEGRADED') return '#B8792515'
  if (s === 'FAULT' || s === 'OFFLINE' || s === 'LOSS') return '#9B2C2C15'
  return '#6B6F6315'
}

function HealthRow({
  label,
  status,
  detail,
  metric,
}: {
  label: string
  status: HealthStatus
  detail?: string
  metric?: string
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3 border-b"
      style={{ borderColor: '#E5DED2' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: statusColor(status) }}
        />
        <div>
          <div className="text-xs font-medium tracking-wider" style={{ color: '#20231E', letterSpacing: '0.06em', fontSize: '11px' }}>
            {label}
          </div>
          {detail && (
            <div className="font-mono text-xs mt-0.5" style={{ fontSize: '9px', color: '#6B6F63' }}>
              {detail}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {metric && (
          <span className="font-mono tabular-nums text-xs" style={{ fontSize: '10px', color: '#6B6F63' }}>
            {metric}
          </span>
        )}
        <span
          className="font-mono text-xs px-2 py-0.5 rounded-sm"
          style={{
            fontSize: '9px',
            letterSpacing: '0.08em',
            color: statusColor(status),
            background: statusBg(status),
          }}
        >
          {status}
        </span>
      </div>
    </div>
  )
}

export default function SystemHealth() {
  const { mission } = useMission()
  const a = mission?.aircraft[0]

  const gpsStatus = a?.gpsMode ?? 'RTK FLOAT'
  const battStatus = (a?.battery ?? 78) < 25 ? 'FAULT' : 'NOMINAL'
  const signalStatus = (a?.signalDbm ?? -67) < -95 ? 'DEGRADED' : 'NOMINAL'
  const latencyStatus = (a?.latencyMs ?? 84) > 150 ? 'DEGRADED' : 'NOMINAL'

  const systems = [
    {
      label: 'TELEMETRY LINK',
      status: signalStatus,
      detail: 'Bidirectional command / status stream',
      metric: `${a?.signalDbm ?? -67} dBm`,
    },
    {
      label: 'GPS / NAVIGATION',
      status: gpsStatus,
      detail: 'Satellite positioning subsystem',
      metric: `${a?.satellites ?? 17} SAT`,
    },
    {
      label: 'OPTICAL CAMERA',
      status: 'NOMINAL',
      detail: 'DR-07 CAM-01 · 1/2.3" sensor · 4K',
      metric: `${a?.latencyMs ?? 84}ms`,
    },
    {
      label: 'THERMAL SENSOR',
      status: 'NOMINAL',
      detail: 'Uncooled microbolometer · 30Hz',
    },
    {
      label: 'AI INFERENCE ENGINE',
      status: 'NOMINAL',
      detail: 'Object detection · thermal + optical fusion',
      metric: '12ms / frame',
    },
    {
      label: 'RADIO LINK',
      status: latencyStatus,
      detail: 'Ground control station uplink',
      metric: `${a?.latencyMs ?? 84}ms RTT`,
    },
    {
      label: 'BATTERY SYSTEM',
      status: battStatus,
      detail: 'Main flight battery · LiPo 6S',
      metric: `${a?.battery.toFixed(0) ?? 78}%`,
    },
    {
      label: 'AIRSPACE STATUS',
      status: 'CLEAR',
      detail: 'DGCA Class D · NOTAM active · No conflicts',
    },
    {
      label: 'COMMAND AUTHORITY',
      status: 'NOMINAL',
      detail: `Operator OP-104 · Session active`,
    },
  ]

  const nominalCount = systems.filter((s) => statusColor(s.status) === '#2D6A4F').length
  const degradedCount = systems.filter((s) => statusColor(s.status) === '#B87925').length
  const faultCount = systems.filter((s) => statusColor(s.status) === '#9B2C2C').length

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F4F1EA' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 border-b"
        style={{ background: '#E5DED2', borderColor: '#C8C2B2' }}
      >
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
            SYSTEM HEALTH — {mission?.name ?? 'RESCUE-042'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#2D6A4F' }} />
            <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>{nominalCount} NOMINAL</span>
          </div>
          {degradedCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#B87925' }} />
              <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>{degradedCount} DEGRADED</span>
            </div>
          )}
          {faultCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#9B2C2C' }} />
              <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>{faultCount} FAULT</span>
            </div>
          )}
        </div>
      </div>

      {/* System list */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-0">
          {systems.map((sys) => (
            <HealthRow key={sys.label} {...sys} />
          ))}
        </div>

        {/* Aircraft inventory */}
        <div className="px-4 pt-6 pb-4">
          <div className="text-xs font-semibold tracking-widest mb-3" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
            AIRCRAFT FLEET STATUS
          </div>
          <div className="grid grid-cols-3 gap-3">
            {mission?.aircraft.map((aircraft) => (
              <div
                key={aircraft.id}
                className="flex flex-col gap-2 p-3 rounded-sm border"
                style={{
                  borderColor: aircraft.status === 'ACTIVE' ? '#4B532040' : '#E5DED2',
                  background: aircraft.status === 'ACTIVE' ? '#4B532008' : '#F4F1EA',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-xs" style={{ color: '#20231E', fontSize: '11px' }}>
                    {aircraft.id}
                  </span>
                  <span
                    className="font-mono text-xs"
                    style={{
                      fontSize: '9px',
                      color:
                        aircraft.status === 'ACTIVE'
                          ? '#2D6A4F'
                          : aircraft.status === 'STANDBY'
                          ? '#B87925'
                          : '#9B2C2C',
                    }}
                  >
                    {aircraft.status}
                  </span>
                </div>
                {aircraft.status !== 'OFFLINE' && (
                  <>
                    <div className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>
                      BAT: {aircraft.battery > 0 ? `${aircraft.battery.toFixed(0)}%` : 'N/A'}
                    </div>
                    <div className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>
                      SIG: {aircraft.signalDbm} dBm
                    </div>
                  </>
                )}
                {aircraft.status === 'OFFLINE' && (
                  <div className="font-mono text-xs" style={{ fontSize: '9px', color: '#9B2C2C' }}>
                    CONNECTION LOST
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 border-t"
        style={{ background: '#E5DED2', borderColor: '#C8C2B2' }}
      >
        <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#9B9590' }}>
          HEALTH MONITOR v1.0 · REFRESH 500ms · AERONOVA CONTROL NODE
        </span>
        <span
          className="font-mono text-xs"
          style={{
            fontSize: '9px',
            color: faultCount > 0 ? '#9B2C2C' : degradedCount > 0 ? '#B87925' : '#2D6A4F',
          }}
        >
          {faultCount > 0 ? '⚠ SYSTEM FAULT' : degradedCount > 0 ? '⚠ DEGRADED' : '● ALL SYSTEMS NOMINAL'}
        </span>
      </div>
    </div>
  )
}
