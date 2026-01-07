/**
 * API Server - REST API and WebSocket server
 * Multi-tenant trading platform API
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { config } from '../config';
import { logger } from '../utils/logger';
import { registry } from '../utils/metrics';

// =============================================================================
// EXPRESS APP SETUP
// =============================================================================

const app: Express = express();
const httpServer = createServer(app);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug({ method: req.method, path: req.path, ip: req.ip }, 'API request');
  next();
});

// =============================================================================
// HEALTH & METRICS
// =============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    service: 'zaara-scalper-service',
    version: '1.0.0',
  });
});

app.get('/metrics', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// API ROUTES
// =============================================================================

app.get(`${config.apiPrefix}/status`, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      service: 'flashscalper',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: Date.now(),
    },
    timestamp: Date.now(),
  });
});

// Placeholder routes - will be implemented based on requirements
app.use(`${config.apiPrefix}/agents`, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Agent endpoints - to be implemented',
    data: [],
    timestamp: Date.now(),
  });
});

app.use(`${config.apiPrefix}/signals`, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Signal endpoints - to be implemented',
    data: [],
    timestamp: Date.now(),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    path: req.path,
    timestamp: Date.now(),
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack, path: req.path }, 'API error');
  res.status(500).json({
    success: false,
    error: config.isProduction ? 'Internal server error' : err.message,
    timestamp: Date.now(),
  });
});

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================

const io = new SocketServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'WebSocket client connected');

  socket.on('subscribe:agent', (agentId: string) => {
    socket.join(`agent:${agentId}`);
    logger.debug({ socketId: socket.id, agentId }, 'Client subscribed to agent');
  });

  socket.on('unsubscribe:agent', (agentId: string) => {
    socket.leave(`agent:${agentId}`);
    logger.debug({ socketId: socket.id, agentId }, 'Client unsubscribed from agent');
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'WebSocket client disconnected');
  });
});

// Export for broadcasting events
function broadcastAgentEvent(agentId: string, eventType: string, payload: any) {
  io.to(`agent:${agentId}`).emit(eventType, {
    agentId,
    payload,
    timestamp: Date.now(),
  });
}

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer() {
  const PORT = config.port;

  httpServer.listen(PORT, () => {
    logger.info(
      {
        port: PORT,
        apiPrefix: config.apiPrefix,
        nodeEnv: config.nodeEnv,
        metricsEnabled: config.metrics.enabled,
      },
      `API server started on port ${PORT}`
    );
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down API server...');
    httpServer.close(() => {
      logger.info('API server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down API server...');
    httpServer.close(() => {
      logger.info('API server closed');
      process.exit(0);
    });
  });
}

// Start if run directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.fatal({ error: error.message }, 'Failed to start API server');
    process.exit(1);
  });
}

export { app, httpServer, io, startServer, broadcastAgentEvent };

