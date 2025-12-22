# FlashScalper Dashboard

Real-time web dashboard for monitoring FlashScalper trading bot.

## Features

- Live equity tracking
- Real-time position monitoring
- Trade history and statistics
- WebSocket-based updates
- Modern, responsive UI

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=http://localhost:3001
```

## Build for Production

```bash
npm run build
npm start
```

## Tech Stack

- Next.js 14
- React 18
- Socket.io Client
- Recharts
- Tailwind CSS

