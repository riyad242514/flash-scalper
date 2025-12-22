import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FlashScalper - Real-time Trading Dashboard',
  description: 'Live trading dashboard for FlashScalper crypto scalping bot',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

