import path from 'path';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import compression from 'compression';
import createError from 'http-errors';
import rateLimit from 'express-rate-limit';

// #region Load Environment
dotenv.config();
// #endregion

// #region App Initialization
const app = express();
// #endregion

// #region Security Configuration
// Enhanced Helmet configuration for better security
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

// Enhanced CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
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

// Enhanced rate limiting with different limits for different endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

// Apply rate limiting
app.use('/api/v1/webhook', strictLimiter); // Stricter limits for webhooks
app.use('/api/v1/hmac', strictLimiter); // Stricter limits for HMAC endpoints
app.use('/api/', standardLimiter); // Standard limits for other API endpoints

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
    level: 6, // Balanced compression level
    threshold: 1024, // Only compress responses > 1KB
    filter: (req: Request, res: Response) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

app.use(cookieParser(process.env.COOKIE_SECRET || 'default-secret-change-in-production'));

// Enhanced JSON parsing with size limits and validation
app.use(
  express.json({
    limit: '10mb', // Reduced from 1gb for security
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
    limit: '10mb',
    parameterLimit: 1000, // Limit number of parameters
  }),
);

// Serve static files with security headers
app.use(
  express.static(path.resolve(__dirname, 'build'), {
    maxAge: '1h', // Cache static files for 1 hour
    etag: true,
    lastModified: true,
    setHeaders: (res: Response, path: string) => {
      if (path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }),
);

// #endregion

// #region API Routes (v1)
import healthRoutes from './routes/v1/healthRoutes';
import hmacRoutes from './routes/v1/hmacRoutes';
import proofRoutes from './routes/v1/proofRoutes';
import webhookRoutes, { rawBodySaver } from './routes/v1/webhookRoutes';
import { loggerService } from './utils/logger';

app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/hmac', hmacRoutes);
app.use('/api/v1/proofs', proofRoutes);
app.use(
  '/api/v1/webhook',
  express.json({ limit: '50mb', verify: rawBodySaver }), // Reduced from 100mb
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
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// 404 Handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404, 'Not Found'));
});
// #endregion

export default app;
