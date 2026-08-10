import { useState } from 'react'
import { useMission } from '../simulation/MissionContext'
import type { EventLog } from '../simulation/telemetry'

const SOURCE_COLORS: Record<EventLog['source'], string> = {
  SYSTEM: '#6B6F63',
  'DR-07': '#7FA9A6',
  AI: '#7FA9A6',
  MISSION: '#4B5320',
  OPERATOR: '#B85C38',
}

const ALL_SOURCES = ['ALL', 'SYSTEM', 'DR-07', 'AI', 'MISSION', 'OPERATOR'] as const

function formatTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

export default function Logs() {
  const { events, mission } = useMission()
  const [filter, setFilter] = useState<string>('ALL')

  const filtered = filter === 'ALL' ? events : events.filter((e) => e.source === filter)

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F4F1EA' }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 border-b"
        style={{ background: '#E5DED2', borderColor: '#C8C2B2' }}
      >
        <div className="flex items-center gap-4">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
            MISSION LOG — {mission?.name ?? 'RESCUE-042'}
          </span>
          <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#6B6F63' }}>
            {events.length} ENTRIES · IMMUTABLE AUDIT RECORD
          </span>
        </div>
        <div className="flex items-center gap-1">
          {ALL_SOURCES.map((src) => (
            <button
              key={src}
              onClick={() => setFilter(src)}
              className="font-mono text-xs px-2 py-1 rounded-sm transition-colors"
              style={{
                fontSize: '9px',
                letterSpacing: '0.08em',
                background: filter === src ? '#4B5320' : 'transparent',
                color: filter === src ? '#F4F1EA' : '#6B6F63',
                border: `1px solid ${filter === src ? '#4B5320' : '#C8C2B2'}`,
              }}
            >
              {src}
            </button>
          ))}
        </div>
      </div>

      {/* Log table */}
      <div className="flex-1 overflow-y-auto">
        {/* Column headers */}
        <div
          className="flex items-center gap-0 px-4 py-1 sticky top-0"
          style={{ background: '#E5DED2', borderBottom: '1px solid #C8C2B2' }}
        >
          <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#9B9590', width: 88, letterSpacing: '0.08em' }}>TIMESTAMP</span>
          <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#9B9590', width: 72, letterSpacing: '0.08em' }}>SOURCE</span>
          <span className="font-mono text-xs flex-1" style={{ fontSize: '9px', color: '#9B9590', letterSpacing: '0.08em' }}>EVENT</span>
        </div>

        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <span className="font-mono text-xs" style={{ color: '#9B9590', fontSize: '10px' }}>NO EVENTS FOR FILTER</span>
          </div>
        ) : (
          <div>
            {filtered.map((ev, i) => (
              <div
                key={ev.id}
                className="flex items-baseline gap-0 px-4 py-1.5 transition-colors hover:bg-white"
                style={{ borderBottom: '1px solid #E5DED240', background: i % 2 === 0 ? 'transparent' : '#F4F1EA80' }}
              >
                <span
                  className="font-mono tabular-nums shrink-0"
                  style={{ fontSize: '10px', color: '#9B9590', width: 88 }}
                >
                  {formatTime(ev.timestamp)}
                </span>
                <span
                  className="font-mono shrink-0 font-medium"
                  style={{
                    fontSize: '10px',
                    color: SOURCE_COLORS[ev.source],
                    width: 72,
                    letterSpacing: '0.06em',
                  }}
                >
                  {ev.source}
                </span>
                <span
                  className="font-mono text-xs flex-1"
                  style={{ fontSize: '10px', color: '#20231E' }}
                >
                  {ev.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 border-t"
        style={{ background: '#E5DED2', borderColor: '#C8C2B2' }}
      >
        <span className="font-mono text-xs" style={{ fontSize: '9px', color: '#9B9590' }}>
          AERONOVA MISSION LOG v1.0 · TAMPER-EVIDENT · OPERATOR ID: OP-104
        </span>
        <button
          className="font-mono text-xs px-3 py-1 rounded-sm border"
          style={{ fontSize: '9px', color: '#6B6F63', borderColor: '#C8C2B2', background: '#F4F1EA' }}
          onClick={() => {
            const content = filtered
              .map((e) => `${formatTime(e.timestamp)}\t${e.source}\t${e.message}`)
              .join('\n')
            const blob = new Blob([content], { type: 'text/plain' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `aeronova-${mission?.name ?? 'mission'}-log.txt`
            a.click()
          }}
        >
          EXPORT LOG
        </button>
      </div>
    </div>
  )
}
