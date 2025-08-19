import { Router, Request, Response } from 'express';

import { performanceService } from '../../services/performanceService';
import { cacheService } from '../../services/cacheService';
import { loggerService } from '../../utils/logger';
import config from '../../config';

const router = Router();

/**
 * Basic health check endpoint
 * GET /api/v1/health
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Get system health status
    const health = performanceService.getOverallHealth();
    const metrics = performanceService.getSystemMetrics();

    const response = {
      status: health.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: config.app.version,
      environment: config.app.environment,
      checks: health.checks.length,
      responseTime: Date.now() - startTime,
    };

    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(response);
  } catch (error) {
    loggerService.logger.error('Health check error', { error: (error as Error).message });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Detailed health check endpoint
 * GET /api/v1/health/detailed
 */
router.get('/detailed', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    // Collect all health information
    const health = performanceService.getOverallHealth();
    const metrics = performanceService.getSystemMetrics();
    const cacheStats = cacheService.getStats();
    const cacheConnected = cacheService.isCacheConnected();

    const response = {
      status: health.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: config.app.version,
      environment: config.app.environment,
      checks: health.checks,
      metrics: {
        memory: {
          used: `${Math.round(metrics.memory.used / 1024 / 1024)}MB`,
          total: `${Math.round(metrics.memory.total / 1024 / 1024)}MB`,
          free: `${Math.round(metrics.memory.free / 1024 / 1024)}MB`,
          percentage: `${metrics.memory.percentage.toFixed(2)}%`,
        },
        cpu: metrics.cpu,
        connections: metrics.activeConnections,
        requests: {
          total: metrics.requestRate,
          errors: metrics.errorRate,
        },
        responseTime: {
          p50: `${metrics.responseTime.p50.toFixed(2)}ms`,
          p95: `${metrics.responseTime.p95.toFixed(2)}ms`,
          p99: `${metrics.responseTime.p99.toFixed(2)}ms`,
        },
      },
      cache: {
        connected: cacheConnected,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        keys: cacheStats.keys,
        memory: `${Math.round(cacheStats.memory / 1024)}KB`,
        hitRate:
          cacheStats.hits + cacheStats.misses > 0
            ? `${((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2)}%`
            : '0%',
      },
      config: {
        performance: {
          compressionLevel: config.performance.compressionLevel,
          cacheTtl: config.performance.cacheTtl,
          workerThreads: config.performance.workerThreads,
          clusterEnabled: config.performance.clusterEnabled,
        },
        monitoring: {
          enableMetrics: config.monitoring.enableMetrics,
          enableHealthChecks: config.monitoring.enableHealthChecks,
          logLevel: config.monitoring.logLevel,
        },
      },
      responseTime: Date.now() - startTime,
    };

    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(response);
  } catch (error) {
    loggerService.logger.error('Detailed health check error', { error: (error as Error).message });
    res.status(503).json({
      status: 'unhealthy',
      error: 'Detailed health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * System metrics endpoint
 * GET /api/v1/health/metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = performanceService.getSystemMetrics();
    const recentMetrics = performanceService.getRecentMetrics(100);

    const response = {
      timestamp: new Date().toISOString(),
      system: metrics,
      recent: recentMetrics,
    };

    res.status(200).json(response);
  } catch (error) {
    loggerService.logger.error('Metrics endpoint error', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Cache status endpoint
 * GET /api/v1/health/cache
 */
router.get('/cache', async (req: Request, res: Response) => {
  try {
    const stats = cacheService.getStats();
    const connected = cacheService.isCacheConnected();

    const response = {
      connected,
      stats,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    loggerService.logger.error('Cache status error', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve cache status',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Readiness probe endpoint
 * GET /api/v1/health/ready
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const health = performanceService.getOverallHealth();
    const metrics = performanceService.getSystemMetrics();

    // Check if system is ready to handle requests
    const isReady =
      health.status !== 'unhealthy' &&
      metrics.memory.percentage < 95 &&
      metrics.responseTime.p95 < 10000;

    const response = {
      ready: isReady,
      status: health.status,
      timestamp: new Date().toISOString(),
      checks: health.checks.length,
    };

    res.status(isReady ? 200 : 503).json(response);
  } catch (error) {
    loggerService.logger.error('Readiness probe error', { error: (error as Error).message });
    res.status(503).json({
      ready: false,
      error: 'Readiness check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Liveness probe endpoint
 * GET /api/v1/health/live
 */
router.get('/live', async (req: Request, res: Response) => {
  try {
    const response = {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      pid: process.pid,
    };

    res.status(200).json(response);
  } catch (error) {
    loggerService.logger.error('Liveness probe error', { error: (error as Error).message });
    res.status(503).json({
      alive: false,
      error: 'Liveness check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * System information endpoint
 * GET /api/v1/health/info
 */
router.get('/info', async (req: Request, res: Response) => {
  try {
    const response = {
      application: {
        name: config.app.name,
        version: config.app.version,
        environment: config.app.environment,
        port: config.app.port,
        host: config.app.host,
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
      config: {
        performance: config.performance,
        monitoring: config.monitoring,
        security: {
          rateLimitEnabled: config.security.rateLimitMax > 0,
          corsEnabled: config.security.corsOrigins.length > 0,
          helmetEnabled: config.security.helmetEnabled,
        },
      },
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    loggerService.logger.error('System info error', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve system information',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
