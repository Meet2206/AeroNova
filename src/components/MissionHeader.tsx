import { useMission } from '../simulation/MissionContext'
import { useEffect, useState } from 'react'

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono tabular-nums text-xs" style={{ color: '#6B6F63' }}>
      {time.toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' })} IST
    </span>
  )
}

export default function MissionHeader({ page, onNavigate }: { page: string; onNavigate: (p: string) => void }) {
  const { mission } = useMission()
  const phase = mission?.phase ?? 'SEARCHING'
  const battery = mission?.aircraft[0]?.battery ?? 78
  const provenance = mission?.provenance ?? 'SIMULATED'

  const provenanceColor =
    provenance === 'LIVE' ? '#2D6A4F' : provenance === 'SIMULATED' ? '#B87925' : '#9B2C2C'

  const navItems = [
    { id: 'dashboard', label: 'MISSION CONTROL' },
    { id: 'camera', label: 'LIVE FEED' },
    { id: 'logs', label: 'LOGS' },
    { id: 'system-health', label: 'SYSTEM HEALTH' },
  ]

  return (
    <header
      className="flex items-center justify-between px-4 h-12 shrink-0 border-b"
      style={{ background: '#30362A', borderColor: '#4B5320' }}
    >
      {/* Brand + Mission ID */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <img
            src="/aeronova-logo.png"
            alt="AeroNova"
            className="w-7 h-7 rounded-sm object-contain"
          />
          <div>
            <div className="text-xs font-semibold tracking-widest" style={{ color: '#F4F1EA', letterSpacing: '0.15em' }}>
              AERONOVA
            </div>
            <div className="text-xs tracking-wider" style={{ color: '#7FA9A6', letterSpacing: '0.1em', fontSize: '9px' }}>
              INDIA · AERIAL RESPONSE SYSTEM
            </div>
          </div>
        </div>

        <div className="w-px h-8" style={{ background: '#4B5320' }} />

        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest" style={{ color: '#E5DED2', letterSpacing: '0.12em' }}>
              MISSION {mission?.name ?? 'RESCUE-042'}
            </div>
            <div className="font-mono text-xs" style={{ color: '#6B6F63', fontSize: '9px' }}>
              {mission?.sector ?? 'SECTOR 04 / GUJARAT'}
            </div>
          </div>

          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-mono font-medium"
            style={{ background: provenanceColor + '22', color: provenanceColor, border: `1px solid ${provenanceColor}44` }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: provenanceColor }}
            />
            {provenance}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex items-center gap-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="px-3 py-1 text-xs font-medium tracking-wider rounded-sm transition-colors"
            style={{
              letterSpacing: '0.08em',
              color: page === item.id ? '#F4F1EA' : '#6B6F63',
              background: page === item.id ? '#4B5320' : 'transparent',
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Status strip */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 font-mono text-xs" style={{ color: '#6B6F63' }}>
          <span style={{ color: '#E5DED2' }}>DR-07</span>
          <span>·</span>
          <span
            style={{
              color: battery > 50 ? '#2D6A4F' : battery > 25 ? '#B87925' : '#9B2C2C',
            }}
          >
            {battery.toFixed(0)}%
          </span>
          <span>·</span>
          <span
            className="font-semibold tracking-wider"
            style={{
              color: phase === 'ARMED' ? '#9B2C2C' : phase === 'EXECUTED' ? '#2D6A4F' : '#7FA9A6',
              fontSize: '10px',
              letterSpacing: '0.1em',
            }}
          >
            {phase}
          </span>
        </div>
        <div className="w-px h-6" style={{ background: '#4B5320' }} />
        <Clock />
      </div>
    </header>
  )
}
