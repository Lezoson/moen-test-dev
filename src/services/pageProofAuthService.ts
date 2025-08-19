import * as crypto from 'crypto';

import { Mutex } from 'async-mutex';

import {
  NodeRequestAdapter,
  PageProof,
  WorkerThreadsCryptoAdapter,
  fs,
  path,
} from '../utils/exports';
import { loggerService } from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';

import { getSecretFromKeyVault } from './keyVaultService';

class PageProofAuthService {
  // #region Config and Constants

  private static readonly SESSION_FILE = path.join(__dirname, '../../session.json');
  private static readonly ENCRYPTION_ALGORITHM = 'aes-256-cbc';
  private static readonly ENCRYPTION_KEY = Buffer.from(
    process.env.ENCRYPTION_KEY ||
      '1a5c86ff5548899742a900b94d1f5b9caf0a24756fdfb8ddd899916278aecb1f',
    'hex',
  );
  private static readonly IV_LENGTH = 16;
  private static readonly RETRY_CONFIG = {
    maxRetries: Number(process.env.RETRY_MAX || 5),
    initialDelay: Number(process.env.RETRY_DELAY || 1000),
    backoffFactor: Number(process.env.RETRY_BACKOFF || 2),
  };

  private static clientPromise: Promise<PageProof> | null = null;
  private static sessionMutex = new Mutex();

  // #endregion

  // #region Encryption Helpers

  private static encrypt(text: string): string {
    try {
      const iv = crypto.randomBytes(this.IV_LENGTH);
      const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (error) {
      loggerService.logger.error('PageProofAuthService: Encryption failed', { error });
      throw error;
    }
  }

  private static decrypt(encryptedData: string): string {
    try {
      if (!encryptedData.includes(':'))
        throw new Error('Invalid encrypted data format: missing IV separator');

      const [ivHex, encrypted] = encryptedData.split(':');

      if (!ivHex || ivHex.length !== this.IV_LENGTH * 2 || !/^[0-9a-fA-F]+$/.test(ivHex)) {
        throw new Error(`Invalid IV: must be ${this.IV_LENGTH * 2} hex characters`);
      }

      if (!encrypted || !/^[0-9a-fA-F]+$/.test(encrypted)) {
        throw new Error('Invalid encrypted data: must be valid hex');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const encryptedBuffer = Buffer.from(encrypted, 'hex');
      const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
      const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (error) {
      loggerService.logger.error('PageProofAuthService: Decryption failed', {
        error,
        encryptedDataLength: encryptedData.length,
      });
      throw error;
    }
  }

  // #endregion

  // #region Session Handling

  /**
   * Loads the session from disk, decrypting it. Ensures lock is always released.
   * If the email or password has changed, returns null to force a new login.
   * @returns The session object or null if not found/error/credentials changed
   */
  private static async getSessionWithCredentialCheck(
    email: string,
    password: string,
  ): Promise<any | null> {
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    return await this.sessionMutex.runExclusive(async () => {
      try {
        const exists = await fs
          .access(this.SESSION_FILE)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          loggerService.logger.info('PageProofAuthService: Session file not found');
          return null;
        }

        const encrypted = await fs.readFile(this.SESSION_FILE, 'utf-8');
        const session = JSON.parse(this.decrypt(encrypted));
        if (session.__email !== email || session.__passwordHash !== passwordHash) {
          loggerService.logger.info(
            'PageProofAuthService: Credentials changed, ignoring old session',
          );
          return null;
        }
        loggerService.logger.info(
          'PageProofAuthService: Session loaded, decrypted, and credentials match',
        );
        // Remove credential fields before returning
        delete session.__email;
        delete session.__passwordHash;
        return session;
      } catch (error) {
        loggerService.logger.warn(
          'PageProofAuthService: Session read failed, continuing with new login',
          { error },
        );
        return null;
      }
    });
  }

  /**
   * Saves the session to disk, encrypting it. Ensures lock is always released.
   * Adds email and password hash for credential change detection.
   * @param session The session object to save
   * @param email The email used for login
   * @param password The password used for login
   */
  private static async saveSessionWithCredentials(
    session: any,
    email: string,
    password: string,
  ): Promise<void> {
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    return await this.sessionMutex.runExclusive(async () => {
      try {
        // Clone session and add credential info
        const sessionToSave = { ...session, __email: email, __passwordHash: passwordHash };
        const encrypted = this.encrypt(JSON.stringify(sessionToSave));
        await fs.writeFile(this.SESSION_FILE, encrypted, 'utf-8');
        loggerService.logger.info(
          'PageProofAuthService: Session encrypted and saved with credentials',
        );
      } catch (error) {
        loggerService.logger.error('PageProofAuthService: Failed to save session', { error });
        throw error;
      }
    });
  }

  // #endregion

  // #region Retry with Exponential Backoff

  /**
   * Retries a function with exponential backoff on failure (especially for rate limits).
   * @param fn The async function to retry
   * @param context Context string for logging
   * @returns The result of the function if successful
   */
  private static async retryWithBackoff<T>(fn: () => Promise<T>, context: string): Promise<T> {
    const { maxRetries, initialDelay, backoffFactor } = this.RETRY_CONFIG;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        if (error?.response?.status === 429) {
          const delay = initialDelay * Math.pow(backoffFactor, attempt);
          loggerService.logger.warn('PageProofAuthService: Rate limit encountered, retrying', {
            context,
            attempt: attempt + 1,
            delay,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          loggerService.logger.error('PageProofAuthService: Retry failed', {
            context,
            attempt: attempt + 1,
            error,
          });
          throw error;
        }
      }
    }

    const finalError = new Error('Max retries reached. API is still throttled.');
    loggerService.logger.error('PageProofAuthService: Max retries exceeded', {
      context,
      error: finalError,
    });
    throw finalError;
  }

  // #endregion

  // #region PageProof Client Initialization

  /**
   * Logs in to PageProof, returning a cached client if available.
   * @returns The PageProof client instance
   */
  public static async loginToPageProof(): Promise<PageProof> {
    if (this.clientPromise) {
      loggerService.logger.info('PageProofAuthService: Using cached client instance');
      return this.clientPromise;
    }

    this.clientPromise = this.initializeClient().catch(error => {
      loggerService.logger.error('PageProofAuthService: Client init failed', { error });
      this.clientPromise = null;
      throw error;
    });

    return this.clientPromise;
  }

  private static async initializeClient(): Promise<PageProof> {
    loggerService.logger.info('PageProofAuthService: Starting client initialization');

    const applicationId = 'fortunebrands-sdk';
    const subscriptionKey = 'y0UTuMyLTlEJr6CUlSseHmYQTLwix44a';
    const email = 'Rola.Luo+sdk@fbin.com';
    const password = 'Rola123!';

    const client = new PageProof({
      options: {
        endpoint: process.env.PAGEPROOF_API_URL,
        applicationId,
        subscriptionKey,
      },
      adapters: [new NodeRequestAdapter(), new WorkerThreadsCryptoAdapter()],
    });

    loggerService.logger.info('PageProofAuthService: PageProof client created');

    let session = await this.getSessionWithCredentialCheck(email, password);

    try {
      if (!session) {
        loggerService.logger.info('PageProofAuthService: No valid session found (or credentials changed), logging in');
        session = await this.retryWithBackoff(
          () => client.accounts.login(email, password),
          'login',
        );
        client.setSession(session);
        await this.saveSessionWithCredentials(session, email, password);
        loggerService.logger.info('PageProofAuthService: New session logged in and saved');
      } else {
        client.setSession(session);
        loggerService.logger.info('PageProofAuthService: Session restored and set to client');
      }
    } catch (error) {
      loggerService.logger.error('PageProofAuthService: Login failed', { error });
      ErrorHandler.handleError(null, 500, 'PageProof login failed', error as Error);
      throw error;
    }

    return client;
  }

  // #endregion
  public static async getCurrentUser(): Promise<{ email: string } | null> {
    return await this.sessionMutex.runExclusive(async () => {
      try {
        const exists = await fs
          .access(this.SESSION_FILE)
          .then(() => true)
          .catch(() => false);

        if (!exists) return null;

        const encrypted = await fs.readFile(this.SESSION_FILE, 'utf-8');
        const session = JSON.parse(this.decrypt(encrypted));

        if (!session.__email) {
          loggerService.logger.warn('PageProofAuthService: __email not found in session');
          return null;
        }

        return { email: session.__email };
      } catch (error) {
        loggerService.logger.error('PageProofAuthService: Failed to get current user', { error });
        return null;
      }
    });
  }
}

export { PageProofAuthService };
