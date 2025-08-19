import * as http from 'http';

import debugLib from 'debug';

import app from '../src/app';
import { loggerService } from '../src/utils/logger';

const debug = debugLib('moen-poc:test');

/**
 * Get port from environment and store in Express.
 */

const port = normalizePort(process.env.PORT || '8080');
app.set('port', port);

/**
 * Create HTTP server.
 */

const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

loggerService.logger.debug(`Express server started (http://localhost:${port}).`);

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

function shutdown() {
  loggerService.logger.info('Received shutdown signal, closing server...');
  server.close(err => {
    if (err) {
      loggerService.logger.error('Error during server shutdown', { error: err });
      process.exit(1);
    }
    loggerService.logger.info('Server closed gracefully. Exiting process.');
    process.exit(0);
  });
}
