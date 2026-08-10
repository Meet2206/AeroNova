import { useMission } from '../simulation/MissionContext'

export default function AircraftList() {
  const { mission } = useMission()
  const aircraft = mission?.aircraft ?? []

  const statusColor = (s: string) =>
    s === 'ACTIVE' ? '#2D6A4F' : s === 'STANDBY' ? '#B87925' : '#9B2C2C'

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-widest mb-1" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
        AIRCRAFT
      </span>
      {aircraft.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between py-1.5 px-2 rounded-sm"
          style={{
            background: a.status === 'ACTIVE' ? '#4B532010' : 'transparent',
            border: `1px solid ${a.status === 'ACTIVE' ? '#4B532030' : '#E5DED2'}`,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: statusColor(a.status) }}
            />
            <span
              className="font-mono text-xs font-semibold"
              style={{ color: a.status === 'ACTIVE' ? '#20231E' : '#9B9590', fontSize: '10px' }}
            >
              {a.id}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {a.battery > 0 && (
              <span
                className="font-mono text-xs tabular-nums"
                style={{ fontSize: '9px', color: a.battery > 50 ? '#2D6A4F' : '#B87925' }}
              >
                {a.battery.toFixed(0)}%
              </span>
            )}
            <span
              className="font-mono text-xs"
              style={{ fontSize: '9px', color: statusColor(a.status), letterSpacing: '0.06em' }}
            >
              {a.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
