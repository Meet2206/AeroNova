import { useRef, useEffect } from 'react'
import { useMission } from '../simulation/MissionContext'
import type { EventLog } from '../simulation/telemetry'

const SOURCE_COLORS: Record<EventLog['source'], string> = {
  SYSTEM: '#6B6F63',
  'DR-07': '#7FA9A6',
  AI: '#7FA9A6',
  MISSION: '#4B5320',
  OPERATOR: '#B85C38',
}

function formatTime(d: Date) {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

export default function EventStream({ maxItems = 8 }: { maxItems?: number }) {
  const { events } = useMission()
  const listRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={listRef} className="flex flex-col gap-0 overflow-hidden">
      {events.slice(0, maxItems).map((ev, i) => (
        <div
          key={ev.id}
          className={`flex items-baseline gap-3 py-0.5 px-0 ${i === 0 ? 'event-new' : ''}`}
          style={{ borderBottom: '1px solid #E5DED230' }}
        >
          <span
            className="font-mono tabular-nums shrink-0"
            style={{ fontSize: '9px', color: '#9B9590', letterSpacing: '0.04em', minWidth: 72 }}
          >
            {formatTime(ev.timestamp)}
          </span>
          <span
            className="font-mono shrink-0 font-medium"
            style={{ fontSize: '9px', color: SOURCE_COLORS[ev.source], minWidth: 56, letterSpacing: '0.06em' }}
          >
            {ev.source}
          </span>
          <span
            className="font-mono text-xs"
            style={{ fontSize: '9px', color: '#20231E', letterSpacing: '0.02em' }}
          >
            {ev.message}
          </span>
        </div>
      ))}
    </div>
  )
}
