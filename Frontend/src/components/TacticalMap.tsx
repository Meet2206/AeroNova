import { useMemo, useRef, useEffect, useState } from 'react'
import { useMission } from '../simulation/MissionContext'

// Map viewport constants
const BASE_LAT = 23.8744
const BASE_LNG = 70.9342
const TARGET_LAT = 23.8801
const TARGET_LNG = 70.9401

interface MapPoint {
  x: number
  y: number
}

function latLngToXY(lat: number, lng: number, viewLat: number, viewLng: number, scale: number, w: number, h: number): MapPoint {
  const x = w / 2 + (lng - viewLng) * scale * Math.cos((viewLat * Math.PI) / 180) * 111320
  const y = h / 2 - (lat - viewLat) * scale * 110540
  return { x, y }
}

export default function TacticalMap({ compact = false }: { compact?: boolean }) {
  const { mission } = useMission()
  const svgRef = useRef<SVGSVGElement>(null)
  const [dims, setDims] = useState({ w: 800, h: 500 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setDims({ w: entry.contentRect.width, h: entry.contentRect.height })
      }
    })
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const aircraft = mission?.aircraft[0]
  const detection = mission?.detection
  const phase = mission?.phase ?? 'SEARCHING'

  // Center map on aircraft, smoothly follow it
  const viewLat = aircraft ? aircraft.lat : BASE_LAT
  const viewLng = aircraft ? aircraft.lng : BASE_LNG
  const scale = compact ? 0.8 : 1.1
  const { w, h } = dims

  const toXY = (lat: number, lng: number) =>
    latLngToXY(lat, lng, viewLat, viewLng, scale, w, h)

  // Drone position
  const dronePos = aircraft ? toXY(aircraft.lat, aircraft.lng) : toXY(BASE_LAT, BASE_LNG)
  const targetPos = detection ? toXY(detection.lat, detection.lng) : toXY(TARGET_LAT, TARGET_LNG)
  const heading = aircraft?.heading ?? 284

  // Search area polygon (hexagonal)
  const searchRadius = 90
  const searchCenter = toXY(BASE_LAT + 0.003, BASE_LNG + 0.004)
  const searchPts = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 - 30) * (Math.PI / 180)
    return `${searchCenter.x + searchRadius * Math.cos(angle)},${searchCenter.y + searchRadius * Math.sin(angle)}`
  }).join(' ')

  // Flight trail (last positions)
  const trailPath = useMemo(() => {
    if (!aircraft) return ''
    // Synthesize recent trail
    const pts = []
    for (let i = 8; i >= 0; i--) {
      const t = i / 8
      const lat = aircraft.lat - 0.0003 * t * Math.cos((heading * Math.PI) / 180)
      const lng = aircraft.lng - 0.0003 * t * Math.sin((heading * Math.PI) / 180)
      const p = toXY(lat, lng)
      pts.push(`${i === 8 ? 'M' : 'L'} ${p.x} ${p.y}`)
    }
    return pts.join(' ')
  }, [aircraft?.lat, aircraft?.lng, heading, viewLat, viewLng, w, h])

  // Camera FOV lines
  const fovAngle = 35
  const fovLen = 70
  const rad = (heading - 180) * (Math.PI / 180)
  const fovL = {
    x: dronePos.x + fovLen * Math.sin(rad - (fovAngle * Math.PI) / 180),
    y: dronePos.y - fovLen * Math.cos(rad - (fovAngle * Math.PI) / 180),
  }
  const fovR = {
    x: dronePos.x + fovLen * Math.sin(rad + (fovAngle * Math.PI) / 180),
    y: dronePos.y - fovLen * Math.cos(rad + (fovAngle * Math.PI) / 180),
  }

  // Heading vector line
  const headingRad = (heading - 90) * (Math.PI / 180)
  const headingEnd = {
    x: dronePos.x + 50 * Math.cos(headingRad),
    y: dronePos.y + 50 * Math.sin(headingRad),
  }

  // Approach vector to target
  const showApproach = phase === 'DETECTED' || phase === 'CONFIRMED' || phase === 'POSITIONED' || phase === 'ARMED' || phase === 'EXECUTED'

  const showTarget = phase !== 'SEARCHING'
  const targetLocked = detection?.locked ?? false

  const gridLines = useMemo(() => {
    const lines = []
    const step = 60
    for (let x = step; x < w; x += step) {
      lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke="#C8C2B2" strokeWidth="0.5" opacity="0.4" />)
    }
    for (let y = step; y < h; y += step) {
      lines.push(<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke="#C8C2B2" strokeWidth="0.5" opacity="0.4" />)
    }
    return lines
  }, [w, h])

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ background: '#EDE8DF' }}>
      {/* Map layer labels */}
      <div
        className="absolute top-3 left-3 font-mono text-xs z-10 flex flex-col gap-1"
        style={{ color: '#6B6F63' }}
      >
        <div style={{ fontSize: '9px', letterSpacing: '0.1em' }}>SECTOR 04 / GUJARAT</div>
        <div style={{ fontSize: '9px', color: '#9B9590' }}>
          {aircraft ? `${aircraft.lat.toFixed(4)}°N ${aircraft.lng.toFixed(4)}°E` : ''}
        </div>
      </div>

      {/* Zoom / legend top right */}
      <div
        className="absolute top-3 right-3 font-mono text-xs z-10 flex flex-col items-end gap-1"
        style={{ color: '#6B6F63' }}
      >
        <div className="flex items-center gap-3" style={{ fontSize: '9px', letterSpacing: '0.1em' }}>
          <span className="flex items-center gap-1">
            <span className="inline-block w-5 h-0.5" style={{ background: '#4B5320' }} /> TRACK
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-5 h-0.5 border-t border-dashed" style={{ borderColor: '#4B5320' }} /> PLANNED
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full border" style={{ borderColor: '#7FA9A6', background: '#7FA9A620' }} />
            AI ZONE
          </span>
        </div>
      </div>

      <svg ref={svgRef} width={w} height={h} className="absolute inset-0">
        {/* Grid */}
        <g>{gridLines}</g>

        {/* Sector boundary */}
        <rect
          x={w * 0.06} y={h * 0.05}
          width={w * 0.88} height={h * 0.9}
          fill="none" stroke="#4B5320" strokeWidth="1" strokeDasharray="8 4" opacity="0.3"
        />
        <text x={w * 0.06 + 4} y={h * 0.05 + 12} fontSize="9" fill="#4B5320" opacity="0.5" fontFamily="JetBrains Mono">
          SECTOR 04 BOUNDARY
        </text>

        {/* No-fly zone */}
        <circle
          cx={w * 0.18} cy={h * 0.22}
          r={32}
          fill="#9B2C2C08"
          stroke="#9B2C2C"
          strokeWidth="0.8"
          strokeDasharray="4 3"
          opacity="0.5"
        />
        <text x={w * 0.18} y={h * 0.22 - 36} textAnchor="middle" fontSize="8" fill="#9B2C2C" opacity="0.6" fontFamily="JetBrains Mono">
          NFZ-01
        </text>

        {/* Search area */}
        <polygon
          points={searchPts}
          fill="#7FA9A6"
          fillOpacity="0.12"
          stroke="#7FA9A6"
          strokeWidth="1"
          strokeDasharray="6 3"
          opacity="0.7"
        />
        <text
          x={searchCenter.x}
          y={searchCenter.y - searchRadius - 6}
          textAnchor="middle"
          fontSize="9"
          fill="#7FA9A6"
          opacity="0.8"
          fontFamily="JetBrains Mono"
        >
          SEARCH ZONE
        </text>

        {/* Flight trail */}
        {trailPath && (
          <path
            d={trailPath}
            fill="none"
            stroke="#4B5320"
            strokeWidth="1.5"
            opacity="0.5"
            strokeLinecap="round"
          />
        )}

        {/* Approach vector to target */}
        {showApproach && detection && (
          <line
            x1={dronePos.x} y1={dronePos.y}
            x2={targetPos.x} y2={targetPos.y}
            stroke="#4B5320"
            strokeWidth="1"
            strokeDasharray="6 4"
            opacity="0.5"
          />
        )}

        {/* Camera FOV */}
        <path
          d={`M ${dronePos.x} ${dronePos.y} L ${fovL.x} ${fovL.y} L ${fovR.x} ${fovR.y} Z`}
          fill="#7FA9A6"
          fillOpacity="0.06"
          stroke="#7FA9A6"
          strokeWidth="0.5"
          strokeDasharray="3 2"
          opacity="0.6"
        />

        {/* Heading arrow */}
        <line
          x1={dronePos.x} y1={dronePos.y}
          x2={headingEnd.x} y2={headingEnd.y}
          stroke="#4B5320"
          strokeWidth="1.5"
          opacity="0.7"
          markerEnd="url(#arrow)"
        />

        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 z" fill="#4B5320" opacity="0.7" />
          </marker>
        </defs>

        {/* Target marker */}
        {showTarget && (
          <g className={targetLocked ? 'reticle-lock' : ''}>
            {/* Outer ring */}
            <circle
              cx={targetPos.x} cy={targetPos.y} r={16}
              fill="none"
              stroke={targetLocked ? '#B85C38' : '#7FA9A6'}
              strokeWidth={targetLocked ? 1.5 : 1}
              opacity="0.7"
            />
            {/* Cross hairs */}
            <line x1={targetPos.x - 22} y1={targetPos.y} x2={targetPos.x - 8} y2={targetPos.y} stroke={targetLocked ? '#B85C38' : '#7FA9A6'} strokeWidth="1" opacity="0.7" />
            <line x1={targetPos.x + 8} y1={targetPos.y} x2={targetPos.x + 22} y2={targetPos.y} stroke={targetLocked ? '#B85C38' : '#7FA9A6'} strokeWidth="1" opacity="0.7" />
            <line x1={targetPos.x} y1={targetPos.y - 22} x2={targetPos.x} y2={targetPos.y - 8} stroke={targetLocked ? '#B85C38' : '#7FA9A6'} strokeWidth="1" opacity="0.7" />
            <line x1={targetPos.x} y1={targetPos.y + 8} x2={targetPos.x} y2={targetPos.y + 22} stroke={targetLocked ? '#B85C38' : '#7FA9A6'} strokeWidth="1" opacity="0.7" />
            {/* Center dot */}
            <circle cx={targetPos.x} cy={targetPos.y} r={3} fill={targetLocked ? '#B85C38' : '#7FA9A6'} />
            {/* Label */}
            <text x={targetPos.x + 22} y={targetPos.y - 10} fontSize="9" fill={targetLocked ? '#B85C38' : '#7FA9A6'} fontFamily="JetBrains Mono" fontWeight="600">
              SURVIVOR
            </text>
            {detection && (
              <text x={targetPos.x + 22} y={targetPos.y + 2} fontSize="9" fill={targetLocked ? '#B85C38' : '#7FA9A6'} fontFamily="JetBrains Mono" opacity="0.8">
                {detection.confidence.toFixed(1)}%
              </text>
            )}
          </g>
        )}

        {/* Aircraft marker */}
        <g>
          {/* Pulse ring */}
          <circle
            cx={dronePos.x} cy={dronePos.y} r={18}
            fill="none" stroke="#4B5320" strokeWidth="0.8" opacity="0.25"
          />
          {/* Body — diamond shape */}
          <polygon
            points={`
              ${dronePos.x},${dronePos.y - 10}
              ${dronePos.x + 7},${dronePos.y}
              ${dronePos.x},${dronePos.y + 10}
              ${dronePos.x - 7},${dronePos.y}
            `}
            fill="#30362A"
            stroke="#4B5320"
            strokeWidth="1.5"
          />
          {/* Center dot */}
          <circle cx={dronePos.x} cy={dronePos.y} r={2} fill="#7FA9A6" />
          {/* Label */}
          <text x={dronePos.x + 14} y={dronePos.y - 12} fontSize="9" fill="#30362A" fontFamily="JetBrains Mono" fontWeight="600">
            DR-07
          </text>
          <text x={dronePos.x + 14} y={dronePos.y} fontSize="8" fill="#6B6F63" fontFamily="JetBrains Mono">
            {Math.round(heading)}° · {aircraft ? aircraft.altitude.toFixed(0) : '184'}m
          </text>
        </g>

        {/* Scale bar */}
        <g>
          <line x1={w - 80} y1={h - 20} x2={w - 40} y2={h - 20} stroke="#6B6F63" strokeWidth="1.5" opacity="0.6" />
          <line x1={w - 80} y1={h - 17} x2={w - 80} y2={h - 23} stroke="#6B6F63" strokeWidth="1.5" opacity="0.6" />
          <line x1={w - 40} y1={h - 17} x2={w - 40} y2={h - 23} stroke="#6B6F63" strokeWidth="1.5" opacity="0.6" />
          <text x={w - 60} y={h - 8} textAnchor="middle" fontSize="8" fill="#6B6F63" opacity="0.7" fontFamily="JetBrains Mono">
            ~50m
          </text>
        </g>
      </svg>
    </div>
  )
}
