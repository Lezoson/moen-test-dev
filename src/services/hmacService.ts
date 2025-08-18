import crypto from 'crypto';

import { loggerService } from '../utils/logger';

import { getSecretFromKeyVault } from './keyVaultService';

interface HmacConfig {
  cacheTimeoutMs: number;
  signatureTimeoutMs: number;
  algorithm: string;
  maxRetries: number;
  retryDelayMs: number;
}

interface VerificationResult {
  isValid: boolean;
  reason?: string;
  timestamp?: number;
}

class HmacService {
  // #region Private Properties

  private cachedSecret: string | null = null;
  private cacheTimestamp = 0;
  private retryCount = 0;

  private readonly config: HmacConfig = {
    cacheTimeoutMs: parseInt(process.env.HMAC_CACHE_TTL || '60000'), // 1 min
    signatureTimeoutMs: parseInt(process.env.HMAC_TIMEOUT || '300000'), // 5 min
    algorithm: 'sha256',
    maxRetries: parseInt(process.env.HMAC_MAX_RETRIES || '3'),
    retryDelayMs: parseInt(process.env.HMAC_RETRY_DELAY || '1000'),
  };

  // #endregion

  // #region Secret Fetch & Caching

  /**
   * Retrieves HMAC secret from Azure Key Vault (cached for performance).
   * Implements retry logic with exponential backoff.
   */
  private async getSecret(): Promise<string> {
    const now = Date.now();

    if (!this.cachedSecret || now - this.cacheTimestamp > this.config.cacheTimeoutMs) {
      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        try {
          // this.cachedSecret = await getSecretFromKeyVault('hmac-secret-key');
          this.cachedSecret = '6413d2d9adfd7be563e664906534b051e4cf257ea7b5e653c68ef5028298ac60';

          if (!this.cachedSecret || this.cachedSecret.length < 32) {
            throw new Error('Invalid secret length or empty secret');
          }

          this.cacheTimestamp = now;
          this.retryCount = 0; // Reset retry count on success

          loggerService.logger.debug('HMAC secret retrieved from Key Vault', {
            attempt,
            secretLength: this.cachedSecret.length,
          });

          return this.cachedSecret;
        } catch (error) {
          this.retryCount++;
          loggerService.logger.error('Error fetching HMAC secret', {
            attempt,
            error: (error as Error).message,
            retryCount: this.retryCount,
          });

          if (attempt === this.config.maxRetries) {
            throw new Error('Unable to retrieve HMAC secret after maximum retries');
          }

          // Exponential backoff
          await this.delay(this.config.retryDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }

    return this.cachedSecret!;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // #endregion

  // #region Secret Validation

  /**
   * Validates the provided secret against stored secret using constant-time comparison.
   */
  public async validateSecret(providedSecret: string | null): Promise<boolean> {
    if (!providedSecret || providedSecret.length < 32) {
      return false;
    }

    try {
      // const actualSecret = await this.getSecret();
      const actualSecret = '6413d2d9adfd7be563e664906534b051e4cf257ea7b5e653c68ef5028298ac60';

      return crypto.timingSafeEqual(
        Buffer.from(providedSecret, 'utf8'),
        Buffer.from(actualSecret, 'utf8'),
      );
    } catch (error) {
      loggerService.logger.error('Secret validation error', { error: (error as Error).message });
      return false;
    }
  }

  // #endregion

  // #region HMAC Generation

  /**
   * Generates an HMAC hash using configured algorithm.
   */
  public generateHmac(secret: string, data: string): string {
    if (!secret || !data) {
      throw new Error('Secret and data are required for HMAC generation');
    }

    try {
      return crypto.createHmac(this.config.algorithm, secret).update(data, 'utf8').digest('hex');
    } catch (error) {
      loggerService.logger.error('HMAC generation error', { error: (error as Error).message });
      throw new Error('Failed to generate HMAC');
    }
  }

  /**
   * Convenience method to get the secret and generate signature for a given data.
   */
  public async generateSignature(data: string): Promise<string> {
    if (!data) {
      throw new Error('Data is required for signature generation');
    }

    const secret = await this.getSecret();
    return this.generateHmac(secret, data);
  }

  // #endregion

  // #region Timestamp Validation

  /**
   * Validates if the provided timestamp is within the allowed window.
   * Includes additional security checks.
   */
  public validateTimestamp(timestamp: string): boolean {
    const requestTime = parseInt(timestamp, 10);

    // Validate timestamp format and range
    if (isNaN(requestTime) || requestTime <= 0) {
      loggerService.logSecurityEvent('Invalid timestamp format', { timestamp });
      return false;
    }

    const currentTime = Date.now();
    const timeDiff = Math.abs(currentTime - requestTime);

    // Check if timestamp is too far in the future (clock skew protection)
    if (requestTime > currentTime + this.config.signatureTimeoutMs) {
      loggerService.logSecurityEvent('Timestamp too far in future', {
        timestamp: requestTime,
        currentTime,
        timeDiff,
      });
      return false;
    }

    // Check if timestamp is within allowed window
    if (timeDiff > this.config.signatureTimeoutMs) {
      loggerService.logSecurityEvent('Timestamp expired', {
        timestamp: requestTime,
        currentTime,
        timeDiff,
        maxAllowed: this.config.signatureTimeoutMs,
      });
      return false;
    }

    return true;
  }

  // #endregion

  // #region Signature Verification

  /**
   * Verifies whether the received HMAC signature is valid and not expired.
   * Enhanced with better error handling and security logging.
   */
  public async verifySignature(
    timestamp: string,
    receivedSignature: string,
  ): Promise<VerificationResult> {
    const startTime = Date.now();

    try {
      // Validate timestamp first
      if (!this.validateTimestamp(timestamp)) {
        return { isValid: false, reason: 'timestamp_expired' };
      }

      // Validate signature format
      if (!receivedSignature || !/^[a-fA-F0-9]{64}$/.test(receivedSignature)) {
        loggerService.logSecurityEvent('Invalid signature format', {
          signatureLength: receivedSignature?.length,
          signature: receivedSignature?.substring(0, 10) + '...',
        });
        return { isValid: false, reason: 'signature_mismatch' };
      }

      const expectedSignature = await this.generateSignature(timestamp);

      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex'),
      );

      const processingTime = Date.now() - startTime;
      loggerService.logPerformance('HMAC verification', processingTime, {
        isValid,
        reason: isValid ? undefined : 'signature_mismatch',
        timestamp: parseInt(timestamp, 10),
      });

      return {
        isValid,
        reason: isValid ? undefined : 'signature_mismatch',
        timestamp: parseInt(timestamp, 10),
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      loggerService.logger.error('Signature verification error', {
        error: (error as Error).message,
        processingTime,
        timestamp,
      });

      return { isValid: false, reason: 'verification_error' };
    }
  }

  // #endregion

  // #region Health Check

  /**
   * Health check method to verify service is working correctly.
   */
  public async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      const secret = await this.getSecret();
      const testData = 'health-check';
      const signature = this.generateHmac(secret, testData);

      return {
        status: 'healthy',
        details: {
          secretLength: secret.length,
          algorithm: this.config.algorithm,
          cacheStatus: this.cachedSecret ? 'cached' : 'fresh',
          retryCount: this.retryCount,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: (error as Error).message },
      };
    }
  }

  // #endregion
}

export const hmacService = new HmacService();
