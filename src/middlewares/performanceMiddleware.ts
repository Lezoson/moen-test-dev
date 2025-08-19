import { performance } from 'perf_hooks';

import { Request, Response, NextFunction } from 'express';

import { loggerService } from '../utils/logger';
import { performanceService } from '../services/performanceService';
import { cacheService } from '../services/cacheService';
import config from '../config';

interface CachedResponse {
  data: any;
  headers: Record<string, string>;
  timestamp: number;
  ttl: number;
}

/**
 * Performance monitoring middleware
 * Tracks request timing, response caching, and performance metrics
 */
export const performanceMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = performance.now();
  const requestId = generateRequestId();

  // Add request ID to request object
  (req as any).requestId = requestId;

  // Track active connections
  performanceService.incrementConnections();

  // Add performance tracking to response
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  // Track response timing
  res.send = function (data: any): Response {
    const duration = performance.now() - startTime;
    trackRequestMetrics(req, res, duration, data);
    performanceService.decrementConnections();
    return originalSend.call(this, data);
  };

  res.json = function (data: any): Response {
    const duration = performance.now() - startTime;
    trackRequestMetrics(req, res, duration, data);
    performanceService.decrementConnections();
    return originalJson.call(this, data);
  };

  res.end = function (chunk?: any, encoding?: any): Response {
    const duration = performance.now() - startTime;
    trackRequestMetrics(req, res, duration, chunk);
    performanceService.decrementConnections();
    return originalEnd.call(this, chunk, encoding);
  };

  // Handle errors
  res.on('error', (error: Error) => {
    const duration = performance.now() - startTime;
    performanceService.recordError();
    performanceService.decrementConnections();

    loggerService.logger.error('Response error', {
      requestId,
      error: error.message,
      duration: `${duration.toFixed(2)}ms`,
      url: req.url,
      method: req.method,
    });
  });

  next();
};

/**
 * Response caching middleware
 * Caches responses for GET requests based on configuration
 */
export const responseCacheMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Only cache GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Skip caching for certain paths
  if (shouldSkipCaching(req.path)) {
    return next();
  }

  const cacheKey = generateCacheKey(req);

  // Check cache first
  cacheService
    .get<CachedResponse>(cacheKey, { prefix: 'response' })
    .then(cachedResponse => {
      if (cachedResponse) {
        // Set cached headers
        Object.entries(cachedResponse.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });

        // Add cache hit header
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Timestamp', cachedResponse.timestamp.toString());

        // Send cached response
        res.status(200).json(cachedResponse.data);

        loggerService.logger.debug('Cache hit', {
          url: req.url,
          cacheKey,
          age: Date.now() - cachedResponse.timestamp,
        });
      } else {
        // Cache miss - proceed with request
        res.setHeader('X-Cache', 'MISS');
        next();
      }
    })
    .catch(error => {
      loggerService.logger.error('Cache error', { error: (error as Error).message });
      next(); // Continue without caching
    });
};

/**
 * Cache response middleware
 * Caches successful responses for future requests
 */
export const cacheResponseMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Only cache GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Skip caching for certain paths
  if (shouldSkipCaching(req.path)) {
    return next();
  }

  const originalSend = res.send;
  const originalJson = res.json;

  res.send = function (data: any): Response {
    if (res.statusCode === 200) {
      cacheResponse(req, res, data);
    }
    return originalSend.call(this, data);
  };

  res.json = function (data: any): Response {
    if (res.statusCode === 200) {
      cacheResponse(req, res, data);
    }
    return originalJson.call(this, data);
  };

  next();
};

/**
 * Compression optimization middleware
 * Optimizes compression based on content type and size
 */
export const compressionOptimizationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Skip compression for already compressed content
  if (req.headers['content-encoding']) {
    return next();
  }

  // Skip compression for small responses
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 0 && contentLength < config.performance.compressionThreshold) {
    res.setHeader('X-Compression', 'SKIPPED');
    return next();
  }

  // Skip compression for binary content
  const contentType = req.headers['content-type'] || '';
  if (
    contentType.includes('image/') ||
    contentType.includes('video/') ||
    contentType.includes('audio/')
  ) {
    res.setHeader('X-Compression', 'SKIPPED');
    return next();
  }

  next();
};

/**
 * Request throttling middleware
 * Implements intelligent request throttling based on system load
 */
export const requestThrottlingMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const metrics = performanceService.getSystemMetrics();

  // Only throttle in production and if system is under extreme load
  if (process.env.NODE_ENV === 'production') {
    // Require minimum data points before throttling
    const minDataPoints = 10;
    const hasEnoughData = metrics.responseTime.p95 > 0 && metrics.memory.percentage > 0;

    if (hasEnoughData) {
      // Throttle if system is under extreme load
      if (metrics.memory.percentage > 95 || metrics.responseTime.p95 > 10000) {
        res.status(503).json({
          error: 'Service temporarily unavailable due to high load',
          retryAfter: 30,
        });
        return;
      }

      // Add delay for non-critical requests under high load
      if (metrics.memory.percentage > 85 || metrics.responseTime.p95 > 5000) {
        const delay = Math.random() * 50; // 0-50ms random delay
        setTimeout(() => next(), delay);
        return;
      }
    }
  }

  next();
};

// Helper functions

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateCacheKey(req: Request): string {
  const url = req.originalUrl || req.url;
  const query = req.query ? JSON.stringify(req.query) : '';
  const userAgent = req.get('User-Agent') || '';

  return `${req.method}:${url}:${query}:${userAgent}`;
}

function shouldSkipCaching(path: string): boolean {
  const skipPaths = ['/api/v1/health', '/api/v1/metrics', '/api/v1/status', '/api-docs'];

  return skipPaths.some(skipPath => path.startsWith(skipPath));
}

function trackRequestMetrics(req: Request, res: Response, duration: number, data: any): void {
  const requestId = (req as any).requestId;

  // Record request timing
  performanceService.recordRequestTime(duration);

  // Log request details
  loggerService.logger.info('Request completed', {
    requestId,
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    duration: `${duration.toFixed(2)}ms`,
    contentLength: data ? JSON.stringify(data).length : 0,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  // Record error if status code indicates error
  if (res.statusCode >= 400) {
    performanceService.recordError();
  }
}

async function cacheResponse(req: Request, res: Response, data: any): Promise<void> {
  try {
    const cacheKey = generateCacheKey(req);
    const headers: Record<string, string> = {};

    // Extract cacheable headers
    const cacheableHeaders = ['content-type', 'content-length', 'etag', 'last-modified'];
    cacheableHeaders.forEach(header => {
      const value = res.getHeader(header);
      if (value) {
        headers[header] = Array.isArray(value) ? value[0] : value.toString();
      }
    });

    const cachedResponse: CachedResponse = {
      data,
      headers,
      timestamp: Date.now(),
      ttl: config.performance.cacheTtl * 1000, // Convert to milliseconds
    };

    await cacheService.set(cacheKey, cachedResponse, {
      prefix: 'response',
      ttl: config.performance.cacheTtl,
    });

    loggerService.logger.debug('Response cached', {
      url: req.url,
      cacheKey,
      ttl: config.performance.cacheTtl,
    });
  } catch (error) {
    loggerService.logger.error('Failed to cache response', {
      error: (error as Error).message,
      url: req.url,
    });
  }
}

// Export middleware functions
export default {
  performanceMiddleware,
  responseCacheMiddleware,
  cacheResponseMiddleware,
  compressionOptimizationMiddleware,
  requestThrottlingMiddleware,
};
