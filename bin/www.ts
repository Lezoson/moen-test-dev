import * as http from 'http';
import cluster from 'node:cluster';
import os from 'node:os';

import debugLib from 'debug';

import app from '../src/app';
import { loggerService } from '../src/utils/logger';
import config from '../src/config';
import { performanceService } from '../src/services/performanceService';
import { cacheService } from '../src/services/cacheService';

const debug = debugLib('moen-poc:test');

/**
 * Get port from configuration and store in Express.
 */

const port = normalizePort(config.app.port.toString());
app.set('port', port);

/**
 * Create HTTP server with enhanced configuration.
 */

const server = http.createServer(app);

// Set server timeouts for better performance
server.timeout = 30000; // 30 seconds
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds

/**
 * Start server with clustering for better performance.
 */
function startServer(): void {
  // Disable clustering in development mode to avoid multiple workers binding to same port
  const shouldUseClustering = config.performance.clusterEnabled && config.isProduction();

  if (shouldUseClustering && cluster.isPrimary) {
    // Fork workers
    const numCPUs = Math.min(config.performance.clusterWorkers, os.cpus().length);
    loggerService.logger.info(`Master process ${process.pid} is running`);
    loggerService.logger.info(`Starting ${numCPUs} worker processes`);

    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      loggerService.logger.warn(`Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork();
    });

    cluster.on('online', worker => {
      loggerService.logger.info(`Worker ${worker.process.pid} is online`);
    });
  } else {
    // Single process or worker process
    const listenPort = typeof port === 'number' ? port : parseInt(port.toString(), 10);
    server.listen(listenPort, config.app.host);
    server.on('error', onError);
    server.on('listening', onListening);

    const processType = shouldUseClustering ? 'Worker' : 'Single Process';
    loggerService.logger.info(
      `${processType} ${process.pid} started on http://${config.app.host}:${listenPort}`,
    );
  }
}

// Start the server
startServer();

/**
 * Normalize a port into a number, string, or false.
 */
function normalizePort(val: string): number | string | false {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event.
 */
function onError(error: { syscall: string; code: string }): void {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      loggerService.logger.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      loggerService.logger.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */
function onListening(): void {
  const addr = server.address();
  const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr?.port;
  debug('Listening on ' + bind);
}

// Add graceful shutdown for production
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  loggerService.logger.info('Received shutdown signal, starting graceful shutdown...');

  try {
    // Shutdown performance service
    await performanceService.shutdown();

    // Shutdown cache service
    await cacheService.shutdown();

    // Close server
    server.close(err => {
      if (err) {
        loggerService.logger.error('Error during server shutdown', { error: err });
        process.exit(1);
      }
      loggerService.logger.info('Server closed gracefully. Exiting process.');
      process.exit(0);
    });
  } catch (error) {
    loggerService.logger.error('Error during graceful shutdown', {
      error: (error as Error).message,
    });
    process.exit(1);
  }
}
