import { useEffect, useRef } from 'react'
import { useMission } from '../simulation/MissionContext'

function drawFrame(canvas: HTMLCanvasElement, phase: string, confidence: number, heading: number, frameNum: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height

  // Ground texture - warm earth tones representing Gujarat terrain
  ctx.fillStyle = '#8B7355'
  ctx.fillRect(0, 0, w, h)

  // Terrain variation
  const time = frameNum * 0.04
  for (let i = 0; i < 12; i++) {
    const tx = (Math.sin(time * 0.3 + i * 1.7) * 0.4 + 0.5) * w
    const ty = (Math.cos(time * 0.2 + i * 1.3) * 0.4 + 0.5) * h
    const r = 20 + (i % 4) * 15
    const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, r)
    g.addColorStop(0, `rgba(${110 + (i % 3) * 20},${90 + (i % 4) * 10},${70},0.4)`)
    g.addColorStop(1, 'transparent')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // Subtle terrain features
  ctx.strokeStyle = 'rgba(60,40,20,0.15)'
  ctx.lineWidth = 0.8
  for (let i = 0; i < 8; i++) {
    const sx = (Math.sin(i * 2.1 + time * 0.05) * 0.5 + 0.5) * w
    const sy = (Math.cos(i * 1.8 + time * 0.04) * 0.5 + 0.5) * h
    ctx.beginPath()
    ctx.arc(sx, sy, 30 + i * 8, 0, Math.PI * 0.6)
    ctx.stroke()
  }

  // Vignette
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8)
  vig.addColorStop(0, 'transparent')
  vig.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  // AI bounding box when detecting
  if (phase !== 'SEARCHING' && confidence > 55) {
    const boxW = w * 0.22
    const boxH = h * 0.28
    const bx = w / 2 - boxW / 2 + Math.sin(time * 2) * 2
    const by = h / 2 - boxH / 2 + Math.cos(time * 1.5) * 1.5
    const isLocked = confidence >= 85

    ctx.strokeStyle = isLocked ? '#B85C38' : '#7FA9A6'
    ctx.lineWidth = 1.5
    ctx.setLineDash([])

    // Corner brackets
    const cl = 12
    const corners = [
      [bx, by],
      [bx + boxW, by],
      [bx + boxW, by + boxH],
      [bx, by + boxH],
    ] as [number, number][]

    corners.forEach(([cx, cy], i) => {
      ctx.beginPath()
      const dx = i === 0 || i === 3 ? cl : -cl
      const dy = i === 0 || i === 1 ? cl : -cl
      ctx.moveTo(cx + dx, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + dy)
      ctx.stroke()
    })

    // Label
    ctx.fillStyle = isLocked ? 'rgba(184,92,56,0.85)' : 'rgba(127,169,166,0.85)'
    ctx.fillRect(bx, by - 20, boxW, 20)
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 9px "JetBrains Mono", monospace`
    ctx.fillText(`HUMAN SURVIVOR  ${confidence.toFixed(1)}%`, bx + 4, by - 6)
  }

  // Crosshair
  const cx = w / 2
  const cy = h / 2
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 0.8
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(cx - 20, cy)
  ctx.lineTo(cx + 20, cy)
  ctx.moveTo(cx, cy - 20)
  ctx.lineTo(cx, cy + 20)
  ctx.stroke()
  ctx.setLineDash([])

  // Center dot
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.beginPath()
  ctx.arc(cx, cy, 2, 0, Math.PI * 2)
  ctx.fill()

  // Heading indicator (top)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(w / 2 - 30, 4, 60, 14)
  ctx.fillStyle = 'rgba(127,169,166,0.9)'
  ctx.font = `500 9px "JetBrains Mono", monospace`
  ctx.textAlign = 'center'
  ctx.fillText(`HDG ${Math.round(heading)}°`, w / 2, 14)
  ctx.textAlign = 'left'
}

export default function LiveFeed({ compact = false }: { compact?: boolean }) {
  const { mission } = useMission()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const rafRef = useRef<number>(0)

  const aircraft = mission?.aircraft[0]
  const detection = mission?.detection
  const phase = mission?.phase ?? 'SEARCHING'
  const confidence = detection?.confidence ?? 0
  const latency = aircraft?.latencyMs ?? 84
  const provenance = mission?.provenance ?? 'SIMULATED'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const loop = () => {
      frameRef.current++
      drawFrame(canvas, phase, confidence, aircraft?.heading ?? 284, frameRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, confidence, aircraft?.heading])

  const provenanceColor = provenance === 'LIVE' ? '#2D6A4F' : provenance === 'SIMULATED' ? '#B87925' : '#9B2C2C'

  return (
    <div className="flex flex-col h-full" style={{ background: '#20231E' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{ background: '#30362A', borderBottom: '1px solid #4B532040' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: provenanceColor }}
          />
          <span className="font-mono text-xs" style={{ color: '#E5DED2', fontSize: '10px', letterSpacing: '0.08em' }}>
            LIVE FEED · {provenance}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono" style={{ fontSize: '9px', color: '#6B6F63' }}>
          <span>DR-07 CAM-01</span>
          <span>·</span>
          <span>FRAME {(frameRef.current % 9999).toString().padStart(4, '0')}</span>
          <span>·</span>
          <span style={{ color: latency > 120 ? '#B87925' : '#6B6F63' }}>{latency}ms</span>
        </div>
      </div>

      {/* Video area */}
      <div className="relative flex-1 min-h-0">
        <canvas
          ref={canvasRef}
          width={compact ? 320 : 480}
          height={compact ? 200 : 300}
          className="w-full h-full"
          style={{ display: 'block', objectFit: 'cover' }}
        />

        {/* Detection overlay badge */}
        {phase !== 'SEARCHING' && detection && (
          <div
            className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2 py-1 rounded-sm"
            style={{ background: 'rgba(48,54,42,0.9)', border: '1px solid #4B5320' }}
          >
            <span className="font-mono text-xs" style={{ color: '#7FA9A6', fontSize: '9px' }}>
              AI · HUMAN SURVIVOR
            </span>
            <span
              className="font-mono font-semibold text-xs tabular-nums"
              style={{ color: detection.confidence >= 85 ? '#2D6A4F' : '#B87925', fontSize: '10px' }}
            >
              {detection.confidence.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
