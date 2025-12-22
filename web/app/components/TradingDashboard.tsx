'use client'

import { useEffect, useState } from 'react'
import { Socket } from 'socket.io-client'
import { format } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

interface Position {
  symbol: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  currentPrice: number
  size: number
  unrealizedPnL: number
  roe: number
}

interface Trade {
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  timestamp: number
  pnl?: number
}

interface AgentStatus {
  equity: number
  dailyPnL: number
  winRate: number
  positionCount: number
  totalTrades: number
  drawdown: number
}

export default function TradingDashboard({ socket, connected }: { socket: Socket; connected: boolean }) {
  const [positions, setPositions] = useState<Position[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [equityHistory, setEquityHistory] = useState<{ time: string; equity: number }[]>([])

  useEffect(() => {
    if (!socket) return

    // Subscribe to agent updates
    socket.emit('subscribe:agent', 'scalper')

    // Listen for agent status updates
    socket.on('agent_status', (data: any) => {
      if (data.payload) {
        setStatus(data.payload)
        setEquityHistory(prev => [
          ...prev.slice(-50), // Keep last 50 points
          { time: format(new Date(), 'HH:mm:ss'), equity: data.payload.equity || 0 }
        ])
      }
    })

    // Listen for trade events
    socket.on('trade_open', (data: any) => {
      const trade: Trade = {
        symbol: data.symbol,
        side: data.side === 'sell' ? 'SELL' : 'BUY',
        price: data.price,
        quantity: data.quantity,
        timestamp: Date.now(),
      }
      setTrades(prev => [trade, ...prev.slice(0, 99)]) // Keep last 100 trades
    })

    socket.on('trade_close', (data: any) => {
      const trade: Trade = {
        symbol: data.symbol,
        side: data.side === 'sell' ? 'SELL' : 'BUY',
        price: data.price,
        quantity: data.quantity,
        timestamp: Date.now(),
        pnl: data.pnl,
      }
      setTrades(prev => [trade, ...prev.slice(0, 99)])
    })

    // Fetch initial status from API
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/status`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          // Initial status would come from API
        }
      })
      .catch(err => console.error('Failed to fetch status:', err))

    return () => {
      socket.off('agent_status')
      socket.off('trade_open')
      socket.off('trade_close')
    }
  }, [socket])

  const totalPnL = positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0)
  const winningTrades = trades.filter(t => t.pnl && t.pnl > 0).length
  const losingTrades = trades.filter(t => t.pnl && t.pnl < 0).length

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">FlashScalper</h1>
            <p className="text-gray-400">Real-time Crypto Scalping Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <div className={`px-4 py-2 rounded-lg ${connected ? 'bg-green-500' : 'bg-red-500'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </div>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm mb-1">Equity</div>
            <div className="text-2xl font-bold">${status.equity.toFixed(2)}</div>
          </div>
          <div className={`bg-gray-800 rounded-lg p-6 ${status.dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            <div className="text-gray-400 text-sm mb-1">Daily P&L</div>
            <div className="text-2xl font-bold">${status.dailyPnL.toFixed(2)}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm mb-1">Win Rate</div>
            <div className="text-2xl font-bold">{(status.winRate * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm mb-1">Positions</div>
            <div className="text-2xl font-bold">{status.positionCount}/{status.totalTrades}</div>
          </div>
        </div>
      )}

      {/* Equity Chart */}
      {equityHistory.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Equity Over Time</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={equityHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
              <Line type="monotone" dataKey="equity" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Open Positions */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4">Open Positions</h2>
          {positions.length === 0 ? (
            <div className="text-gray-400 text-center py-8">No open positions</div>
          ) : (
            <div className="space-y-2">
              {positions.map((pos, idx) => (
                <div key={idx} className="bg-gray-700 rounded p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold">{pos.symbol}</div>
                      <div className="text-sm text-gray-400">
                        {pos.side} {pos.size} @ ${pos.entryPrice.toFixed(2)}
                      </div>
                    </div>
                    <div className={`text-right ${pos.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      <div className="font-bold">${pos.unrealizedPnL.toFixed(2)}</div>
                      <div className="text-sm">{pos.roe.toFixed(2)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4">Recent Trades</h2>
          {trades.length === 0 ? (
            <div className="text-gray-400 text-center py-8">No trades yet</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {trades.slice(0, 20).map((trade, idx) => (
                <div key={idx} className="bg-gray-700 rounded p-3 text-sm">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-bold">{trade.symbol}</span>
                      <span className={`ml-2 ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                        {trade.side}
                      </span>
                    </div>
                    <div className="text-right">
                      <div>${trade.price.toFixed(2)}</div>
                      {trade.pnl !== undefined && (
                        <div className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                          ${trade.pnl.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {format(new Date(trade.timestamp), 'HH:mm:ss')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Trade Stats */}
      {trades.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-6 mt-8">
          <h2 className="text-xl font-bold mb-4">Trade Statistics</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-gray-400 text-sm">Total Trades</div>
              <div className="text-2xl font-bold">{trades.length}</div>
            </div>
            <div className="text-green-400">
              <div className="text-gray-400 text-sm">Winning</div>
              <div className="text-2xl font-bold">{winningTrades}</div>
            </div>
            <div className="text-red-400">
              <div className="text-gray-400 text-sm">Losing</div>
              <div className="text-2xl font-bold">{losingTrades}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

