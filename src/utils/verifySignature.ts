import { createHmac, timingSafeEqual } from 'node:crypto';

import { Request } from 'express';
import { z } from 'zod';

import { getSecretFromKeyVault } from '../services/keyVaultService';

import { loggerService } from './logger';

class VerifySignature {
  private static WEBHOOK_SIGNING_SECRET: string | null = null;
  private static initializationPromise: Promise<void> | null = null;
  private static lastInitAttempt = 0;
  private static readonly INIT_RETRY_DELAY = 5000; // 5 seconds

  // Initialize the secret from Key Vault asynchronously with retry logic
  private static async initializeSecret(): Promise<void> {
    const now = Date.now();

    // Prevent multiple simultaneous initialization attempts
    if (this.initializationPromise && now - this.lastInitAttempt < this.INIT_RETRY_DELAY) {
      return this.initializationPromise;
    }

    this.lastInitAttempt = now;
    this.initializationPromise = this.performInitialization();

    return this.initializationPromise;
  }

  private static async performInitialization(): Promise<void> {
    try {
      // Try to fetch from Key Vault first
      const secretKey = await getSecretFromKeyVault('webhook-hmac-secret');
      if (secretKey && secretKey.length >= 32) {
        this.WEBHOOK_SIGNING_SECRET = z.string().min(32).parse(secretKey);
        loggerService.logger.info('Webhook secret initialized from Key Vault');
        return;
      }

      // Fallback to environment variable
      const envSecret = process.env.HMAC_SECRET;
      if (envSecret && envSecret.length >= 32) {
        this.WEBHOOK_SIGNING_SECRET = z.string().min(32).parse(envSecret);
        loggerService.logger.warn(
          'Webhook secret initialized from environment variable (fallback)',
        );
        return;
      }

      throw new Error('No valid webhook secret found in Key Vault or environment');
    } catch (error) {
      loggerService.logger.error('Failed to initialize webhook secret:', {
        error: (error as Error).message,
        hasKeyVaultSecret: !!process.env.AZURE_KEYVAULTURL,
        hasEnvSecret: !!process.env.HMAC_SECRET,
      });
      throw error;
    }
  }

  // Call initializeSecret once during application startup
  public static async initialize(): Promise<void> {
    try {
      await this.initializeSecret();
    } catch (error) {
      loggerService.logger.error('Webhook secret initialization failed:', error);
      // Don't throw here to allow application to start, but log the error
    }
  }

  // Method to validate if a request is signed correctly by PageProof
  public static async isRequestSignedByPageProof(req: Request): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Ensure the secret is initialized before proceeding
      if (!this.WEBHOOK_SIGNING_SECRET) {
        loggerService.logger.error('Webhook secret not initialized yet.');
        return false;
      }

      const signature = req.headers['x-pageproof-signature'];

      // Check if the signature header is present and is a string
      if (typeof signature !== 'string') {
        loggerService.logSecurityEvent('Missing or invalid signature header', {
          signatureType: typeof signature,
          hasSignature: !!signature,
        });
        return false;
      }

      // Validate signature format (should be hex string)
      if (!/^[a-fA-F0-9]{64}$/.test(signature)) {
        loggerService.logSecurityEvent('Invalid signature format', {
          signatureLength: signature.length,
          signaturePrefix: signature.substring(0, 10),
        });
        return false;
      }

      // Use the raw body if available, otherwise fallback to JSON.stringify
      const rawBody = (req as any).rawBody
        ? Buffer.from((req as any).rawBody)
        : Buffer.from(JSON.stringify(req.body || {}));

      // Validate raw body
      if (!rawBody || rawBody.length === 0) {
        loggerService.logSecurityEvent('Empty or missing request body', {
          hasRawBody: !!(req as any).rawBody,
          bodyLength: rawBody?.length || 0,
        });
        return false;
      }

      // Generate the HMAC using the secret and the raw request body
      const hmac = createHmac('sha256', this.WEBHOOK_SIGNING_SECRET).update(rawBody).digest();

      const isValid = timingSafeEqual(Buffer.from(signature, 'hex'), hmac);

      const processingTime = Date.now() - startTime;
      loggerService.logPerformance('PageProof signature verification', processingTime, {
        isValid,
        bodyLength: rawBody.length,
        signatureLength: signature.length,
      });

      if (!isValid) {
        loggerService.logSecurityEvent('PageProof signature verification failed', {
          bodyLength: rawBody.length,
          signatureLength: signature.length,
          processingTime,
        });
      }

      return isValid;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      loggerService.logger.error('Error during PageProof signature verification:', {
        error: (error as Error).message,
        processingTime,
        stack: (error as Error).stack,
      });
      return false;
    }
  }

  // Method to generate a test signature for debugging/health checks
  public static async generateTestSignature(data: string): Promise<string> {
    if (!this.WEBHOOK_SIGNING_SECRET) {
      await this.initializeSecret();
    }

    if (!this.WEBHOOK_SIGNING_SECRET) {
      throw new Error('Webhook secret not available for test signature generation');
    }

    return createHmac('sha256', this.WEBHOOK_SIGNING_SECRET).update(data).digest('hex');
  }

  // Method to validate the service health
  public static async healthCheck(): Promise<{ status: string; details?: any }> {
    try {
      if (!this.WEBHOOK_SIGNING_SECRET) {
        await this.initializeSecret();
      }

      if (!this.WEBHOOK_SIGNING_SECRET) {
        return {
          status: 'unhealthy',
          details: { error: 'Webhook secret not initialized' },
        };
      }

      // Test signature generation
      const testData = 'health-check-' + Date.now();
      const signature = await this.generateTestSignature(testData);

      return {
        status: 'healthy',
        details: {
          secretLength: this.WEBHOOK_SIGNING_SECRET.length,
          algorithm: 'sha256',
          testSignatureLength: signature.length,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: (error as Error).message },
      };
    }
  }

  // Method to refresh the secret (useful for key rotation)
  public static async refreshSecret(): Promise<void> {
    this.WEBHOOK_SIGNING_SECRET = null;
    this.initializationPromise = null;
    await this.initializeSecret();
  }
}

// Initialize the WebhookService
VerifySignature.initialize().catch(error => {
  loggerService.logger.error('Failed to initialize webhook signature verification:', error);
});

export { VerifySignature as verifySignature };
