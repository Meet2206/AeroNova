import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { MissionSimulator, type MissionState, type EventLog } from './telemetry'

interface MissionContextValue {
  mission: MissionState | null
  events: EventLog[]
  authorizePositioning: () => void
  authorizeExecution: () => void
  cancelArmed: () => void
}

const MissionContext = createContext<MissionContextValue>({
  mission: null,
  events: [],
  authorizePositioning: () => {},
  authorizeExecution: () => {},
  cancelArmed: () => {},
})

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const [mission, setMission] = useState<MissionState | null>(null)
  const [events, setEvents] = useState<EventLog[]>([])
  const simRef = useRef<MissionSimulator | null>(null)

  useEffect(() => {
    const sim = new MissionSimulator()
    simRef.current = sim

    sim.subscribe((state, newEvents) => {
      setMission(state)
      if (newEvents.length > 0) {
        setEvents((prev) => [...newEvents, ...prev].slice(0, 200))
      }
    })

    sim.start()
    return () => sim.stop()
  }, [])

  return (
    <MissionContext.Provider
      value={{
        mission,
        events,
        authorizePositioning: () => simRef.current?.authorizePositioning(),
        authorizeExecution: () => simRef.current?.authorizeExecution(),
        cancelArmed: () => simRef.current?.cancelArmed(),
      }}
    >
      {children}
    </MissionContext.Provider>
  )
}

export function useMission() {
  return useContext(MissionContext)
}
