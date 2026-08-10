import { io, type Socket } from 'socket.io-client'

export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_SERVER || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin)
export const rtcConfig: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

export type LinkState = 'OFFLINE' | 'CONNECTING' | 'WAITING FOR OPERATOR' | 'CONNECTING TO UAV' | 'LIVE' | 'RECONNECTING' | 'ERROR'

export function createSignalingSocket(): Socket {
  return io(SIGNALING_URL, { transports: ['websocket'], autoConnect: true })
}
