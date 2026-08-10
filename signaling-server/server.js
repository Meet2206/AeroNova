import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'

const app = express()
app.use(cors({ origin: process.env.FRONTEND_URL || true }))
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: process.env.FRONTEND_URL || true, methods: ['GET', 'POST'] } })
let drone = null
let operator = null
io.on('connection', (socket) => {
  socket.on('join-drone', () => { drone = socket; operator?.emit('operator-ready') })
  socket.on('join-operator', () => { operator = socket; drone?.emit('operator-ready') })
  socket.on('offer', (offer) => operator?.emit('offer', offer))
  socket.on('answer', (answer) => drone?.emit('answer', answer))
  socket.on('ice-candidate', ({ role, candidate }) => (role === 'drone' ? operator : drone)?.emit('ice-candidate', candidate))
  socket.on('disconnect', () => { if (drone?.id === socket.id) { drone = null; operator?.emit('peer-disconnected') } if (operator?.id === socket.id) { operator = null; drone?.emit('peer-disconnected') } })
})
server.listen(process.env.PORT || 3001, () => console.log('AeroNova signaling server listening on 3001'))
