import { Request, Response, NextFunction } from 'express';

import { hmacService } from '../services/hmacService';
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

  // #region Verify Middleware

  /**
   * Middleware to verify HMAC signature before processing secure routes.
   */
  public verify = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    try {
      const { timestamp, signature } = this.extractHeaders(req);

      // Validate presence of headers
      if (!timestamp || !signature) {
        loggerService.logger.warn('HMAC missing headers', {
          ip: req.ip,
          missingHeaders: {
            'x-timestamp': !timestamp,
            'x-signature': !signature,
          },
        });

        res.status(400).json({ error: 'Missing required HMAC headers' });
        return;
      }

      // Validate signature
      const verification = await hmacService.verifySignature(timestamp, signature);

      if (!verification.isValid) {
        const errorMessages = {
          timestamp_expired: 'HMAC signature has expired',
          signature_mismatch: 'Invalid HMAC signature',
          verification_error: 'HMAC verification failed',
        };

        loggerService.logger.warn('HMAC verification failed', {
          ip: req.ip,
          reason: verification.reason,
          timestamp,
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
        processingTimeMs: Date.now() - startTime,
      });

      next();
    } catch (error) {
      loggerService.logger.error('HMAC verification exception', {
        error: (error as Error).message,
        ip: req.ip,
        processingTimeMs: Date.now() - startTime,
      });

      res.status(500).json({
        error: 'Internal server error during HMAC verification',
      });
    }
  };

  // #endregion
}

export const hmacValidator = new HmacValidator();
