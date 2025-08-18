import { Request, Response } from 'express';

import { hmacService } from '../services/hmacService';
import { loggerService } from '../utils/logger';

class HmacController {
  // #region Header Extraction

  /**
   * Extracts the 'x-secret-key' header and handles multiple values.
   */
  private extractSecretHeader(req: Request): string | null {
    const header = req.headers['x-secret-key'];
    return Array.isArray(header) ? header[0] : header || null;
  }

  // #endregion

  // #region Public Routes

  /**
   * Generates an HMAC signature and timestamp if the secret key is valid.
   * Validates the incoming 'x-secret-key' header against the Azure Key Vault secret.
   */
  public generateHmacSignature = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      const headerSecret = this.extractSecretHeader(req);

      // Validate header secret before proceeding
      const isValidSecret = await hmacService.validateSecret(headerSecret);
      if (!isValidSecret) {
        loggerService.logger.warn('Unauthorized HMAC generation attempt', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });

        res.status(401).json({ error: 'Invalid or missing x-secret-key header' });
        return;
      }

      const timestamp = Date.now().toString();
      const signature = await hmacService.generateSignature(timestamp);

      loggerService.logger.info('HMAC signature generated', {
        ip: req.ip,
        processingTime: Date.now() - startTime,
      });

      res.json({ timestamp, signature });
    } catch (error) {
      loggerService.logger.error('Error generating HMAC signature', {
        error,
        processingTime: Date.now() - startTime,
      });

      res.status(500).json({
        error: 'Failed to generate HMAC signature',
      });
    }
  };

  // #endregion
}

export const hmacController = new HmacController();
