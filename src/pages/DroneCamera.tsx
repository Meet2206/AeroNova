import { useEffect, useRef, useState } from 'react'
import { createSignalingSocket, rtcConfig, type LinkState } from '../webrtc/peer'

export default function DroneCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const socketRef = useRef<ReturnType<typeof createSignalingSocket> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<LinkState>('OFFLINE')
  const [error, setError] = useState('')

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    socketRef.current?.disconnect()
    socketRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState('OFFLINE')
  }

  const start = async () => {
    setError('')
    setState('CONNECTING')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      const socket = createSignalingSocket()
      socketRef.current = socket
      socket.on('connect', () => { setState('WAITING FOR OPERATOR'); socket.emit('join-drone', { node: 'UAV-07' }) })
      socket.on('operator-ready', async () => {
        const pc = new RTCPeerConnection(rtcConfig)
        pcRef.current = pc
        stream.getTracks().forEach((track) => pc.addTrack(track, stream))
        pc.onicecandidate = (event) => event.candidate && socket.emit('ice-candidate', { role: 'drone', candidate: event.candidate })
        pc.onconnectionstatechange = () => pc.connectionState === 'connected' && setState('LIVE')
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('offer', offer)
        setState('CONNECTING TO UAV')
      })
      socket.on('answer', async (answer: RTCSessionDescriptionInit) => pcRef.current && pcRef.current.setRemoteDescription(answer))
      socket.on('ice-candidate', async (candidate: RTCIceCandidateInit) => pcRef.current && pcRef.current.addIceCandidate(candidate))
      socket.on('disconnect', () => setState('RECONNECTING'))
      socket.on('connect_error', () => { setState('ERROR'); setError('MISSION LINK UNAVAILABLE') })
    } catch (cause) {
      setState('ERROR')
      setError((cause as DOMException).name === 'NotAllowedError' ? 'Camera access is required to broadcast the UAV feed.' : 'Rear camera unavailable.')
    }
  }

  useEffect(() => stop, [])
  return <main className="flex h-full flex-col bg-[#20231E] text-[#E5DED2] font-mono">
    <header className="flex items-center justify-between border-b border-[#4B5320] bg-[#30362A] px-5 py-4"><div><div className="tracking-[.2em]">AERONOVA</div><div className="text-[10px] text-[#7FA9A6]">UAV-07 · FIELD CAMERA</div></div><div className="text-xs text-[#B87925]">{state}</div></header>
    <div className="relative flex-1 min-h-0"><video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" /><div className="absolute inset-0 pointer-events-none flex items-center justify-center text-xs tracking-[.2em] text-white/30">CAMERA PREVIEW</div></div>
    <footer className="flex items-center justify-between border-t border-[#4B5320] bg-[#30362A] px-5 py-4"><span className="text-xs">● {state === 'LIVE' ? 'STREAMING' : state}</span>{error && <span className="text-[10px] text-[#B85C38]">{error}</span>}<button onClick={state === 'OFFLINE' || state === 'ERROR' ? start : stop} className="border border-[#B85C38] px-4 py-2 text-xs tracking-[.12em] text-[#E5DED2]">{state === 'OFFLINE' || state === 'ERROR' ? 'START STREAM' : 'STOP STREAM'}</button></footer>
  </main>
}
