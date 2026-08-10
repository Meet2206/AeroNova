import RemoteDroneFeed from '../components/RemoteDroneFeed'
import AIDetectionPanel from '../components/AIDetectionPanel'
import FlightTelemetry from '../components/FlightTelemetry'
import MissionStateTrack from '../components/MissionStateTrack'
import SafetyGate from '../components/SafetyGate'
import EventStream from '../components/EventStream'

export default function Dashboard() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F4F1EA' }}>
      <div className="flex flex-1 min-h-0">
        <aside className="hidden lg:block w-64 shrink-0 overflow-y-auto border-r p-3" style={{ borderColor: '#C8C2B2', background: '#F4F1EA' }}>
          <AIDetectionPanel />
        </aside>
        <section className="flex-1 min-w-0 relative border-r" style={{ borderColor: '#C8C2B2' }}>
          <RemoteDroneFeed />
        </section>
        <aside className="hidden lg:flex w-80 shrink-0 flex-col overflow-hidden" style={{ background: '#F4F1EA' }}>
          <div className="flex-1 overflow-y-auto p-3"><FlightTelemetry /></div>
        </aside>
      </div>
      <div className="shrink-0 border-t" style={{ borderColor: '#C8C2B2', background: '#F4F1EA' }}>
        <div className="flex items-center gap-5 px-5 py-3 border-b" style={{ borderColor: '#E5DED2' }}>
          <span className="font-mono text-[10px] font-semibold tracking-[.16em]" style={{ color: '#4B5320' }}>MISSION</span>
          <div className="flex-1"><MissionStateTrack /></div>
          <div className="w-80"><SafetyGate /></div>
        </div>
        <div className="px-5 py-2 max-h-24 overflow-y-auto"><div className="mb-1 font-mono text-[10px] font-semibold tracking-[.16em]" style={{ color: '#4B5320' }}>EVENT STREAM</div><EventStream maxItems={4} /></div>
      </div>
    </div>
  )
}
