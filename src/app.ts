import path from 'path';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import createError from 'http-errors';
// import rateLimit from 'express-rate-limit';

// Import configuration and services
import config from './config';
import { loggerService } from './utils/logger';
import {
  performanceMiddleware,
  responseCacheMiddleware,
  cacheResponseMiddleware,
  compressionOptimizationMiddleware,
  requestThrottlingMiddleware,
} from './middlewares/performanceMiddleware';

// #region App Initialization
const app = express();
// #endregion

// #region Security Configuration
// Enhanced Helmet configuration for better security
if (config.security.helmetEnabled) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
}

// Enhanced CORS configuration
const corsOptions = {
  origin: config.security.corsOrigins,
  credentials: config.security.corsCredentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-timestamp',
    'x-signature',
    'x-pageproof-signature',
  ],
  maxAge: 86400, // 24 hours
};
app.use(cors(corsOptions));

// Rate limiting removed for PowerApps integration
// Enhanced rate limiting with different limits for different endpoints
// const strictLimiter = rateLimit({
//   windowMs: config.security.rateLimitWindowMs,
//   max: config.security.rateLimitMaxStrict, // Strict limit for webhook endpoints
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: 'Too many requests from this IP, please try again later.',
//   skipSuccessfulRequests: false,
//   skipFailedRequests: false,
// });

// const standardLimiter = rateLimit({
//   windowMs: config.security.rateLimitWindowMs,
//   max: config.security.rateLimitMax, // Higher limit for PowerApps integration
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: 'Too many requests from this IP, please try again later.',
//   skipSuccessfulRequests: false,
//   skipFailedRequests: false,
// });

// // PowerApps-friendly limiter with higher limits
// const powerAppsLimiter = rateLimit({
//   windowMs: config.security.rateLimitWindowMs,
//   max: config.security.rateLimitMax * 2, // Double the standard limit for PowerApps
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: 'Too many requests from this IP, please try again later.',
//   skipSuccessfulRequests: false,
//   skipFailedRequests: false,
// });

// Rate limiting completely removed for PowerApps integration
loggerService.logger.info('Rate limiting disabled for PowerApps integration');

// Additional security headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// #endregion

// #region Middleware
app.use(
  compression({
    level: config.performance.compressionLevel,
    threshold: config.performance.compressionThreshold,
    filter: (req: Request, res: Response) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

app.use(cookieParser(config.security.jwtSecret));

// Enhanced JSON parsing with size limits and validation
app.use(
  express.json({
    limit: config.performance.jsonLimit,
    strict: true,
    verify: (req: Request, res: Response, buf: Buffer) => {
      try {
        JSON.parse(buf.toString());
      } catch (e) {
        throw new Error(e);
      }
    },
  }),
);

app.use(
  express.urlencoded({
    extended: false,
    limit: config.performance.urlencodedLimit,
    parameterLimit: 1000, // Limit number of parameters
  }),
);

// Serve static files with security headers
app.use(
  express.static(path.resolve(__dirname, 'build'), {
    maxAge: config.performance.staticCacheMaxAge * 1000, // Convert to milliseconds
    etag: true,
    lastModified: true,
    setHeaders: (res: Response, path: string) => {
      if (path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', `public, max-age=${config.performance.staticCacheMaxAge}`);
      }
    },
  }),
);

// #endregion

// #region Performance Middleware
// Add performance monitoring and optimization middleware
if (config.monitoring.enableRequestLogging) {
  app.use(performanceMiddleware);
}

if (config.performance.enableResponseCaching) {
  app.use(responseCacheMiddleware);
  app.use(cacheResponseMiddleware);
}

app.use(compressionOptimizationMiddleware);

// Disable request throttling for integration APIs to ensure reliable communication
// between PageProof and PowerApps
// if (config.monitoring.enableMetrics && config.isProduction()) {
//   app.use(requestThrottlingMiddleware);
// }
// #endregion

// #region API Routes (v1)
import healthRoutes from './routes/v1/healthRoutes';
import hmacRoutes from './routes/v1/hmacRoutes';
import proofRoutes from './routes/v1/proofRoutes';
import webhookRoutes, { rawBodySaver } from './routes/v1/webhookRoutes';

app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/hmac', hmacRoutes);
app.use('/api/v1/proofs', proofRoutes);
app.use(
  '/api/v1/webhook',
  express.json({ limit: config.app.maxRequestBodySize, verify: rawBodySaver }),
  webhookRoutes,
);

// #endregion

// #region Error Handling
// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const statusCode = (err as any).statusCode || 500;
  const message = statusCode === 500 ? 'Internal Server Error' : err.message;

  // Log error details
  loggerService.logger.warn('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  res.status(statusCode).json({
    error: message,
    ...(config.isDevelopment() && { stack: err.stack }),
  });
});

// 404 Handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404, 'Not Found'));
});
// #endregion

export default app;
