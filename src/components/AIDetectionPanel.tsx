import { useMission } from '../simulation/MissionContext'

function ConfBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: '#E5DED2' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums w-8 text-right" style={{ color: '#20231E', fontSize: '10px' }}>
        {value.toFixed(0)}%
      </span>
    </div>
  )
}

function ConfidenceGraph({ history }: { history: { t: number; v: number }[] }) {
  if (history.length < 2) return null
  const w = 200
  const h = 48
  const minV = 50
  const maxV = 100
  const padX = 8

  const pts = history.map((p, i) => {
    const x = padX + ((i / (history.length - 1)) * (w - padX * 2))
    const y = h - ((p.v - minV) / (maxV - minV)) * (h - 8) - 4
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
  })
  const pathD = pts.join(' ')

  // 85% threshold line
  const threshY = h - ((85 - minV) / (maxV - minV)) * (h - 8) - 4

  return (
    <div className="w-full">
      <div className="flex justify-between mb-1" style={{ fontSize: '9px', color: '#6B6F63', fontFamily: 'JetBrains Mono' }}>
        <span>CONFIDENCE TREND</span>
        <span>LOCK ▶ 85%</span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {/* Threshold line */}
        <line x1={padX} y1={threshY} x2={w - padX} y2={threshY} stroke="#B85C38" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.6" />
        <text x={w - padX - 2} y={threshY - 2} fontSize="7" fill="#B85C38" textAnchor="end" opacity="0.7" fontFamily="JetBrains Mono">85</text>

        {/* Axes */}
        <line x1={padX} y1={0} x2={padX} y2={h} stroke="#C8C2B2" strokeWidth="0.5" />
        <line x1={padX} y1={h - 2} x2={w - padX} y2={h - 2} stroke="#C8C2B2" strokeWidth="0.5" />

        {/* Area fill */}
        <path
          d={`${pathD} L ${w - padX} ${h - 2} L ${padX} ${h - 2} Z`}
          fill="#7FA9A6"
          fillOpacity="0.15"
        />

        {/* Line */}
        <path d={pathD} fill="none" stroke="#7FA9A6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export default function AIDetectionPanel() {
  const { mission } = useMission()
  const detection = mission?.detection
  const phase = mission?.phase ?? 'SEARCHING'

  const hasDetection = detection !== null && phase !== 'SEARCHING'

  if (!hasDetection) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
            AI DETECTION
          </span>
          <span className="font-mono text-xs" style={{ color: '#6B6F63', fontSize: '9px' }}>SEARCHING</span>
        </div>
        <div
          className="flex flex-col items-center justify-center py-6 rounded-sm"
          style={{ background: '#E5DED2', border: '1px dashed #C8C2B2' }}
        >
          <div className="font-mono text-xs" style={{ color: '#9B9590', fontSize: '10px' }}>
            NO DETECTION
          </div>
          <div className="font-mono text-xs mt-1" style={{ color: '#B8B2A8', fontSize: '9px' }}>
            PATTERN ACTIVE
          </div>
        </div>
      </div>
    )
  }

  const locked = detection!.locked
  const conf = detection!.confidence

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
          AI DETECTION
        </span>
        <span
          className="font-mono text-xs px-2 py-0.5 rounded-sm"
          style={{
            background: locked ? '#B85C3820' : '#7FA9A620',
            color: locked ? '#B85C38' : '#7FA9A6',
            fontSize: '9px',
          }}
        >
          {locked ? 'LOCKED' : 'TRACKING'}
        </span>
      </div>

      {/* Primary detection */}
      <div
        className="p-3 rounded-sm"
        style={{ background: locked ? '#B85C3810' : '#7FA9A610', border: `1px solid ${locked ? '#B85C3830' : '#7FA9A630'}` }}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold" style={{ color: '#20231E', letterSpacing: '0.05em' }}>
              HUMAN SURVIVOR
            </div>
            <div className="font-mono text-xs mt-0.5" style={{ color: '#6B6F63', fontSize: '9px' }}>
              TGT-001 · {phase}
            </div>
          </div>
          <div
            className="text-right font-mono"
            style={{ color: conf >= 85 ? '#2D6A4F' : conf >= 70 ? '#B87925' : '#B85C38' }}
          >
            <div className="text-lg font-semibold tabular-nums leading-none">
              {conf.toFixed(1)}
            </div>
            <div style={{ fontSize: '9px', color: '#6B6F63' }}>CONFIDENCE</div>
          </div>
        </div>
      </div>

      {/* Signal breakdown */}
      <div className="flex flex-col gap-2">
        <div className="text-xs" style={{ color: '#6B6F63', fontSize: '9px', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono' }}>
          SIGNAL ANALYSIS
        </div>
        <div className="flex flex-col gap-2">
          <div>
            <div className="flex justify-between mb-1">
              <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>THERMAL SIGNATURE</span>
            </div>
            <ConfBar value={detection!.thermal} color="#7FA9A6" />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>MOTION VECTOR</span>
            </div>
            <ConfBar value={detection!.motion} color="#7FA9A6" />
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>SHAPE CLASS.</span>
            </div>
            <ConfBar value={detection!.shape} color="#7FA9A6" />
          </div>
        </div>
      </div>

      {/* Signals positive */}
      <div className="flex items-center justify-between py-2 border-t" style={{ borderColor: '#E5DED2' }}>
        <span className="font-mono text-xs" style={{ color: '#6B6F63', fontSize: '9px' }}>SIGNALS POSITIVE</span>
        <span
          className="font-mono text-sm font-semibold tabular-nums"
          style={{ color: detection!.positiveSignals >= 3 ? '#2D6A4F' : '#B87925' }}
        >
          {detection!.positiveSignals} / {detection!.totalSignals}
        </span>
      </div>

      {/* Location */}
      <div className="flex flex-col gap-1 py-2 border-t" style={{ borderColor: '#E5DED2' }}>
        <span className="font-mono text-xs" style={{ color: '#6B6F63', fontSize: '9px' }}>GEOLOCATION</span>
        <div className="font-mono text-xs tabular-nums" style={{ color: '#20231E', fontSize: '10px' }}>
          {detection!.lat.toFixed(4)}° N  {detection!.lng.toFixed(4)}° E
        </div>
      </div>

      {/* Confidence graph */}
      {mission!.confidenceHistory.length > 2 && (
        <div className="py-2 border-t" style={{ borderColor: '#E5DED2' }}>
          <ConfidenceGraph history={mission!.confidenceHistory} />
        </div>
      )}
    </div>
  )
}
