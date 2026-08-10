import { useState, useRef } from 'react'
import { useMission } from '../simulation/MissionContext'
import { motion } from 'framer-motion'

export default function SafetyGate() {
  const { mission, authorizePositioning, authorizeExecution, cancelArmed } = useMission()
  const phase = mission?.phase ?? 'SEARCHING'
  const [sliderVal, setSliderVal] = useState(0)
  const sliderRef = useRef<HTMLInputElement>(null)

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    setSliderVal(v)
    if (v >= 95) {
      authorizePositioning()
      setSliderVal(0)
    }
  }

  const handleSliderRelease = () => {
    if (sliderVal < 95) setSliderVal(0)
  }

  if (phase === 'SEARCHING' || phase === 'DETECTED' || phase === 'CONFIRMED') {
    return (
      <div
        className="flex flex-col gap-2 p-3 rounded-sm"
        style={{ background: '#E5DED2', border: '1px solid #C8C2B2' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#4B5320', letterSpacing: '0.12em', fontSize: '10px' }}>
            SAFETY GATE
          </span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded-sm"
            style={{ background: '#C8C2B2', color: '#6B6F63', fontSize: '9px' }}
          >
            LOCKED
          </span>
        </div>
        <div className="font-mono text-xs" style={{ color: '#9B9590', fontSize: '9px' }}>
          POSITIONING REQUIRED BEFORE AUTHORIZATION
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="w-3 h-3 flex items-center justify-center">
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
              <rect x="1" y="5" width="8" height="7" rx="1" fill="#9B9590" />
              <path d="M3 5V3.5a2 2 0 014 0V5" stroke="#9B9590" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
          <span className="font-mono" style={{ fontSize: '9px', color: '#9B9590' }}>
            GATE AVAILABLE AT: POSITIONED
          </span>
        </div>
      </div>
    )
  }

  if (phase === 'POSITIONED') {
    return (
      <div
        className="flex flex-col gap-3 p-3 rounded-sm"
        style={{ background: '#B85C3810', border: '1px solid #B85C3840' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#B85C38', letterSpacing: '0.12em', fontSize: '10px' }}>
            SAFETY GATE
          </span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded-sm"
            style={{ background: '#B85C3820', color: '#B85C38', border: '1px solid #B85C3840', fontSize: '9px' }}
          >
            UNLOCKED
          </span>
        </div>
        <div className="font-mono text-xs" style={{ color: '#B85C38', fontSize: '9px' }}>
          TARGET POSITION VERIFIED · SLIDE TO AUTHORIZE
        </div>

        {/* Slider track */}
        <div className="relative mt-1">
          <div
            className="w-full h-9 rounded-sm flex items-center relative overflow-hidden"
            style={{ background: '#E5DED2', border: '1px solid #B85C3850' }}
          >
            {/* Fill */}
            <div
              className="absolute left-0 top-0 h-full transition-none"
              style={{
                width: `${sliderVal}%`,
                background: 'linear-gradient(90deg, #B85C3830, #B85C3850)',
              }}
            />

            {/* Track label */}
            <span
              className="absolute inset-0 flex items-center justify-center font-mono pointer-events-none select-none"
              style={{ fontSize: '9px', color: '#B85C3870', letterSpacing: '0.12em' }}
            >
              SLIDE TO AUTHORIZE ⟶
            </span>

            <input
              ref={sliderRef}
              type="range"
              min={0}
              max={100}
              value={sliderVal}
              onChange={handleSliderChange}
              onMouseUp={handleSliderRelease}
              onTouchEnd={handleSliderRelease}
              className="safety-slider absolute inset-0 w-full opacity-0 cursor-grab"
              style={{ height: '100%' }}
            />

            {/* Thumb indicator */}
            <div
              className="absolute top-0 h-full w-9 flex items-center justify-center pointer-events-none"
              style={{
                left: `calc(${sliderVal}% - 18px)`,
                background: '#B85C38',
                transition: sliderVal === 0 ? 'left 300ms' : 'none',
              }}
            >
              <span style={{ color: '#F4F1EA', fontSize: '12px' }}>⟶</span>
            </div>
          </div>
        </div>

        <div className="font-mono" style={{ fontSize: '8px', color: '#9B9590' }}>
          ⚠ DELIBERATE OPERATOR ACTION REQUIRED — CANNOT BE UNDONE
        </div>
      </div>
    )
  }

  if (phase === 'ARMED') {
    return (
      <motion.div
        initial={{ opacity: 0.6 }}
        animate={{ opacity: 1 }}
        className="flex flex-col gap-3 p-3 rounded-sm"
        style={{ background: '#9B2C2C18', border: '2px solid #9B2C2C60' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#9B2C2C', letterSpacing: '0.12em', fontSize: '10px' }}>
            ⚠ SYSTEM ARMED
          </span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded-sm"
            style={{ background: '#9B2C2C', color: '#F4F1EA', fontSize: '9px' }}
          >
            ARMED
          </span>
        </div>
        <div className="font-mono text-xs" style={{ color: '#9B2C2C', fontSize: '9px' }}>
          TARGET POSITION VERIFIED · OPERATOR AUTHORIZATION RECEIVED
        </div>
        <div className="flex gap-2">
          <button
            onClick={cancelArmed}
            className="flex-1 py-2 font-mono text-xs rounded-sm border transition-colors"
            style={{
              borderColor: '#6B6F63',
              color: '#6B6F63',
              fontSize: '10px',
              letterSpacing: '0.1em',
              background: 'transparent',
            }}
          >
            CANCEL
          </button>
          <button
            onClick={authorizeExecution}
            className="flex-1 py-2 font-mono text-xs font-bold rounded-sm transition-all"
            style={{
              background: '#9B2C2C',
              color: '#F4F1EA',
              fontSize: '10px',
              letterSpacing: '0.1em',
            }}
          >
            AUTHORIZE EXECUTION
          </button>
        </div>
        <div className="font-mono" style={{ fontSize: '8px', color: '#9B2C2C80' }}>
          THIS ACTION CANNOT BE REVERSED AFTER EXECUTION
        </div>
      </motion.div>
    )
  }

  if (phase === 'EXECUTED') {
    return (
      <div
        className="flex flex-col gap-2 p-3 rounded-sm"
        style={{ background: '#2D6A4F18', border: '1px solid #2D6A4F40' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-widest" style={{ color: '#2D6A4F', letterSpacing: '0.12em', fontSize: '10px' }}>
            MISSION EXECUTED
          </span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded-sm"
            style={{ background: '#2D6A4F', color: '#F4F1EA', fontSize: '9px' }}
          >
            COMPLETE
          </span>
        </div>
        <div className="font-mono text-xs" style={{ color: '#2D6A4F', fontSize: '9px' }}>
          EXECUTION AUTHORIZED BY OPERATOR · MISSION LOG CLOSED
        </div>
      </div>
    )
  }

  return null
}
