import { Request, Response, NextFunction } from 'express';

import { hmacService } from '../services/hmacService';
import { cacheService } from '../services/cacheService';
import { performanceService } from '../services/performanceService';
import { loggerService } from '../utils/logger';

class HmacValidator {
  // #region Extract Headers

  /**
   * Extracts HMAC-related headers (x-timestamp and x-signature) from the request.
   */
  private extractHeaders(req: Request): {
    timestamp: string | null;
    signature: string | null;
  } {
    const getHeader = (name: string): string | null => {
      const header = req.headers[name];
      return Array.isArray(header) ? header[0] : header || null;
    };

    return {
      timestamp: getHeader('x-timestamp'),
      signature: getHeader('x-signature'),
    };
  }

  // #endregion

  // #region Cache Management

  /**
   * Generate cache key for HMAC verification
   */
  private generateCacheKey(timestamp: string, signature: string): string {
    return `hmac:verify:${timestamp}:${signature}`;
  }

  /**
   * Check cache for previous verification results
   */
  private async checkCache(timestamp: string, signature: string): Promise<boolean | null> {
    try {
      const cacheKey = this.generateCacheKey(timestamp, signature);
      const cachedResult = await cacheService.get<boolean>(cacheKey, {
        prefix: 'verification',
        ttl: 60,
      });
      return cachedResult;
    } catch (error) {
      loggerService.logger.debug('Cache check failed', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Cache verification result
   */
  private async cacheResult(timestamp: string, signature: string, isValid: boolean): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(timestamp, signature);
      await cacheService.set(cacheKey, isValid, { prefix: 'verification', ttl: 60 });
    } catch (error) {
      loggerService.logger.debug('Cache set failed', { error: (error as Error).message });
    }
  }

  // #endregion

  // #region Verify Middleware

  /**
   * Optimized middleware to verify HMAC signature with caching and performance monitoring.
   */
  public verify = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    return performanceService.measureAsync('hmac.verification', async () => {
      try {
        const { timestamp, signature } = this.extractHeaders(req);

        // Validate presence of headers
        if (!timestamp || !signature) {
          loggerService.logger.warn('HMAC missing headers', {
            ip: req.ip,
            url: req.originalUrl,
            missingHeaders: {
              'x-timestamp': !timestamp,
              'x-signature': !signature,
            },
          });

          res.status(400).json({ error: 'Missing required HMAC headers' });
          return;
        }

        // Check cache first
        const cachedResult = await this.checkCache(timestamp, signature);
        if (cachedResult !== null) {
          if (cachedResult) {
            loggerService.logger.debug('HMAC verification cache hit', {
              ip: req.ip,
              processingTimeMs: Date.now() - startTime,
            });
            next();
            return;
          } else {
            loggerService.logger.warn('HMAC verification failed (cached)', {
              ip: req.ip,
              timestamp,
            });
            res.status(401).json({ error: 'Invalid HMAC signature' });
            return;
          }
        }

        // Perform actual verification
        const verification = await hmacService.verifySignature(timestamp, signature);

        // Cache the result
        await this.cacheResult(timestamp, signature, verification.isValid);

        if (!verification.isValid) {
          const errorMessages = {
            timestamp_expired: 'HMAC signature has expired',
            signature_mismatch: 'Invalid HMAC signature',
            verification_error: 'HMAC verification failed',
          };

          loggerService.logger.warn('HMAC verification failed', {
            ip: req.ip,
            url: req.originalUrl,
            reason: verification.reason,
            timestamp,
            processingTimeMs: Date.now() - startTime,
          });

          res.status(401).json({
            error:
              errorMessages[verification.reason as keyof typeof errorMessages] ||
              'HMAC verification failed',
          });
          return;
        }

        // Success
        loggerService.logger.debug('HMAC verification passed', {
          ip: req.ip,
          url: req.originalUrl,
          processingTimeMs: Date.now() - startTime,
        });

        next();
      } catch (error) {
        const processingTime = Date.now() - startTime;
        loggerService.logger.error('HMAC verification exception', {
          error: (error as Error).message,
          ip: req.ip,
          url: req.originalUrl,
          processingTimeMs: processingTime,
        });

        // Record error metrics
        performanceService.recordError();
        performanceService.recordMetric('hmac.verification.error', processingTime, 'milliseconds');

        res.status(500).json({
          error: 'Internal server error during HMAC verification',
        });
      }
    });
  };

  // #endregion
}

export const hmacValidator = new HmacValidator();
