import { useEffect, useRef, useState } from 'react'
import { createSignalingSocket, rtcConfig, type LinkState } from '../webrtc/peer'

export default function RemoteDroneFeed() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<LinkState>('CONNECTING')
  useEffect(() => {
    const socket = createSignalingSocket()
    const pc = new RTCPeerConnection(rtcConfig)
    pc.ontrack = (event) => { if (videoRef.current) videoRef.current.srcObject = event.streams[0]; setState('LIVE') }
    pc.onicecandidate = (event) => event.candidate && socket.emit('ice-candidate', { role: 'operator', candidate: event.candidate })
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') setState('ERROR'); if (pc.connectionState === 'disconnected') setState('RECONNECTING') }
    socket.on('connect', () => { setState('WAITING FOR OPERATOR'); socket.emit('join-operator') })
    socket.on('offer', async (offer: RTCSessionDescriptionInit) => { setState('CONNECTING TO UAV'); await pc.setRemoteDescription(offer); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('answer', answer) })
    socket.on('ice-candidate', (candidate: RTCIceCandidateInit) => pc.addIceCandidate(candidate).catch(() => undefined))
    socket.on('peer-disconnected', () => setState('OFFLINE'))
    socket.on('connect_error', () => setState('ERROR'))
    return () => { socket.disconnect(); pc.close(); if (videoRef.current) videoRef.current.srcObject = null }
  }, [])
  return <div className="flex h-full flex-col" style={{ background: '#20231E' }}><div className="flex items-center justify-between border-b border-[#4B5320] bg-[#30362A] px-3 py-3 font-mono text-[10px] tracking-[.1em] text-[#E5DED2]"><span>● UAV-07 LIVE FEED</span><span className={state === 'LIVE' ? 'text-[#2D6A4F]' : 'text-[#B87925]'}>{state}</span></div><div className="relative min-h-0 flex-1"><video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center font-mono text-xs tracking-[.2em] text-white/30">{state === 'LIVE' ? '' : 'WAITING FOR UAV FEED'}</span></div></div>
}
