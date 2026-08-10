import { useState } from 'react'
import { MissionProvider } from './simulation/MissionContext'
import MissionHeader from './components/MissionHeader'
import Dashboard from './pages/Dashboard'
import Camera from './pages/Camera'
import Logs from './pages/Logs'
import SystemHealth from './pages/SystemHealth'
import DroneCamera from './pages/DroneCamera'

type Page = 'dashboard' | 'camera' | 'logs' | 'system-health'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')

  if (window.location.pathname === '/drone-camera') return <MissionProvider><DroneCamera /></MissionProvider>

  return (
    <MissionProvider>
      <div
        className="flex flex-col h-full overflow-hidden"
        style={{ fontFamily: 'Inter, sans-serif', background: '#0D0F11' }}
      >
        <MissionHeader page={page} onNavigate={(p) => setPage(p as Page)} />

        <main className="flex-1 min-h-0 overflow-hidden">
          {page === 'dashboard' && <Dashboard />}
          {page === 'camera' && <Camera />}
          {page === 'logs' && <Logs />}
          {page === 'system-health' && <SystemHealth />}
        </main>
      </div>
    </MissionProvider>
  )
}
