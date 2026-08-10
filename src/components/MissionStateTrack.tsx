import { useMission } from '../simulation/MissionContext'
import type { MissionPhase } from '../simulation/telemetry'

const PHASES: MissionPhase[] = ['SEARCHING', 'DETECTED', 'CONFIRMED', 'POSITIONED', 'ARMED', 'EXECUTED']

const PHASE_COLORS: Record<MissionPhase, string> = {
  SEARCHING: '#4B5320',
  DETECTED: '#4B5320',
  CONFIRMED: '#4B5320',
  POSITIONED: '#4B5320',
  ARMED: '#9B2C2C',
  EXECUTED: '#2D6A4F',
}

const PHASE_TYPE: Record<MissionPhase, 'auto' | 'human' | 'critical'> = {
  SEARCHING: 'auto',
  DETECTED: 'auto',
  CONFIRMED: 'auto',
  POSITIONED: 'auto',
  ARMED: 'human',
  EXECUTED: 'human',
}

export default function MissionStateTrack() {
  const { mission } = useMission()
  const currentPhase = mission?.phase ?? 'SEARCHING'
  const currentIdx = PHASES.indexOf(currentPhase)

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto">
      {PHASES.map((phase, i) => {
        const isPast = i < currentIdx
        const isCurrent = i === currentIdx
        const isFuture = i > currentIdx
        const type = PHASE_TYPE[phase]
        const color = isCurrent ? PHASE_COLORS[phase] : isPast ? '#4B5320' : '#C8C2B2'

        return (
          <div key={phase} className="flex items-center">
            {/* Node */}
            <div className="flex flex-col items-center gap-1">
              <div
                className="relative flex items-center justify-center"
                style={{ width: 28, height: 28 }}
              >
                {/* Outer ring for current */}
                {isCurrent && (
                  <div
                    className="absolute inset-0 rounded-full border-2"
                    style={{ borderColor: color, opacity: 0.3 }}
                  />
                )}
                <div
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                  style={{
                    borderColor: color,
                    background: isCurrent || isPast ? color : 'transparent',
                  }}
                >
                  {isPast && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1.5 4L3 5.5L6.5 2" stroke="#F4F1EA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {isCurrent && (
                    <div className="w-2 h-2 rounded-full" style={{ background: '#F4F1EA' }} />
                  )}
                </div>
              </div>
              <span
                className="font-mono whitespace-nowrap"
                style={{
                  fontSize: '8px',
                  letterSpacing: '0.08em',
                  color: isCurrent ? color : isFuture ? '#B8B2A8' : '#6B6F63',
                  fontWeight: isCurrent ? '600' : '400',
                }}
              >
                {phase}
              </span>
              {/* Type indicator */}
              <span
                className="font-mono"
                style={{
                  fontSize: '7px',
                  color: type === 'human' ? '#B85C38' : type === 'critical' ? '#9B2C2C' : '#9B9590',
                  letterSpacing: '0.06em',
                }}
              >
                {type === 'human' ? 'OPERATOR' : type === 'critical' ? 'CRITICAL' : 'AUTO'}
              </span>
            </div>

            {/* Connector */}
            {i < PHASES.length - 1 && (
              <div
                className="flex-1 h-px mx-1"
                style={{
                  background: i < currentIdx ? '#4B5320' : '#C8C2B2',
                  width: 24,
                  minWidth: 24,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
