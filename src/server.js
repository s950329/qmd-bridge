import express from 'express';
import { createLogger } from './utils/logger.js';
import { getServerConfig, getTenants } from './utils/config.js';
import healthRouter from './routes/health.js';
import qmdRouter from './routes/qmd.js';
import indexRouter from './routes/index.js';
import { createMcpHandler } from './mcp/index.js';
import { IndexingManager } from './services/indexing.js';
import { GRACEFUL_SHUTDOWN_TIMEOUT, PID_FILE } from './constants.js';
import { writeFileSync, unlinkSync } from 'node:fs';

const logger = createLogger({ toFile: true });
const app = express();

// Middleware
app.use(express.json());

// Attach logger to app for use in routes
app.set('logger', logger);

// Initialize IndexingManager and attach to app
const indexingManager = new IndexingManager(logger);
app.set('indexingManager', indexingManager);

// MCP endpoint (Model Context Protocol via Streamable HTTP)
app.post('/mcp', createMcpHandler());

// Routes
app.use(healthRouter);
app.use(qmdRouter);
app.use(indexRouter);

// Error handling middleware (catch-all)
app.use((err, req, res, _next) => {
  logger.error({ err: err.message }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

// Start server
const config = getServerConfig();
const server = app.listen(config.port, config.host, () => {
  // Write PID file
  writeFileSync(PID_FILE, process.pid.toString(), 'utf-8');

  logger.info(
    { port: config.port, host: config.host, pid: process.pid },
    'qmd-bridge server started',
  );

  // Start background indexing after server is listening
  indexingManager.start(getTenants());
});

// Graceful Shutdown
function gracefulShutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal, stopping server...');

  // Stop background indexing
  indexingManager.stop();

  // Stop accepting new connections
  server.close(() => {
    logger.info('All connections closed, shutting down.');
    cleanup();
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.warn('Graceful shutdown timeout reached, forcing exit.');
    cleanup();
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT);
}

function cleanup() {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // PID file may already be removed
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
