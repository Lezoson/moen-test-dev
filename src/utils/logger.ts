import path from 'path';
import fs from 'fs';

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { Request, Response, NextFunction } from 'express';

class LoggerService {
  private logDir: string = path.join(__dirname, '../logs');

  constructor() {
    this.setupLogDirectory();
  }

  private setupLogDirectory(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  // Sanitize sensitive data from logs
  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'x-signature',
      'x-timestamp',
      'x-pageproof-signature',
      'hmac',
      'signature',
      'apiKey',
      'apikey',
    ];

    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    // Recursively sanitize nested objects
    for (const key in sanitized) {
      if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    }

    return sanitized;
  }

  private logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    const sanitizedMetadata = this.sanitizeData(metadata);
    const metadataStr = Object.entries(sanitizedMetadata)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${value}`;
      })
      .join(', ');

    const logMessage = metadataStr ? `${message} - ${metadataStr}` : message;
    return `[${timestamp}] ${level.toUpperCase()}: ${logMessage}`;
  });

  public logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.colorize({ all: true }),
      this.logFormat,
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
      new DailyRotateFile({
        dirname: this.logDir,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true, // Enable compression
        maxFiles: '14d', // Keep logs for 14 days
        maxSize: '20mb', // Rotate when file reaches 20MB
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
      // Error log file
      new DailyRotateFile({
        dirname: this.logDir,
        filename: 'error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxFiles: '30d', // Keep error logs longer
        maxSize: '20mb',
        level: 'error',
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    ],
    // Handle uncaught exceptions
    exceptionHandlers: [
      new DailyRotateFile({
        dirname: this.logDir,
        filename: 'exceptions-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxFiles: '30d',
        maxSize: '20mb',
      }),
    ],
    // Handle unhandled promise rejections
    rejectionHandlers: [
      new DailyRotateFile({
        dirname: this.logDir,
        filename: 'rejections-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxFiles: '30d',
        maxSize: '20mb',
      }),
    ],
  });

  public requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    // Capture response data
    const originalSend = res.send;
    res.send = function (data: any) {
      const responseTime = Date.now() - startTime;

      // Log request details (sanitized)
      const logData: any = {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length'),
        referer: req.get('Referer'),
      };

      // Only log body for non-sensitive endpoints and sanitize sensitive data
      if (req.body && !req.originalUrl.includes('/webhook') && !req.originalUrl.includes('/hmac')) {
        logData.body = this.sanitizeData(req.body);
      }

      this.logger.info(`HTTP ${req.method} ${req.originalUrl}`, logData);

      return originalSend.call(this, data);
    }.bind(this);

    next();
  };

  public errorLogger = (err: Error, req: Request, res: Response): void => {
    this.logger.error(`Error: ${err.message}`, {
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      stack: err.stack,
      body: this.sanitizeData(req.body),
      headers: this.sanitizeData(req.headers),
    });

    res.status(500).json({ error: 'Internal Server Error' });
  };

  // Method to log security events
  public logSecurityEvent(event: string, details: any): void {
    this.logger.warn(`Security Event: ${event}`, {
      ...this.sanitizeData(details),
      timestamp: new Date().toISOString(),
    });
  }

  // Method to log performance metrics
  public logPerformance(operation: string, duration: number, metadata?: any): void {
    this.logger.info(`Performance: ${operation}`, {
      duration: `${duration}ms`,
      ...this.sanitizeData(metadata),
    });
  }
}

export const loggerService = new LoggerService();
