'use client'

import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import TradingDashboard from './components/TradingDashboard'

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'
    const newSocket = io(apiUrl, {
      transports: ['websocket', 'polling'],
    })

    newSocket.on('connect', () => {
      console.log('Connected to server')
      setConnected(true)
    })

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server')
      setConnected(false)
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [])

  if (!socket) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Connecting to trading server...</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white">
      <TradingDashboard socket={socket} connected={connected} />
    </main>
  )
}

