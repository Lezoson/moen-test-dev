import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

import { loggerService } from '../utils/logger';

/**
 * Service for securely fetching and caching secrets from Azure Key Vault.
 * Implements singleton pattern and in-memory caching with configurable TTL.
 */
class KeyVaultService {
  // #region Singleton + Core Setup

  private static instance: KeyVaultService;
  private client: SecretClient;
  private secretCache: Map<string, { value: string; fetchedAt: number }> = new Map();
  private readonly CACHE_TTL = Number(process.env.KEYVAULT_CACHE_TTL ?? 5 * 60 * 1000); // ms, default 5 min

  private constructor(keyVaultUrl: string) {
    const credential = new DefaultAzureCredential();
    this.client = new SecretClient(keyVaultUrl, credential);
  }

  /**
   * Returns a singleton instance of the KeyVaultService.
   */
  public static getInstance(): KeyVaultService {
    if (!KeyVaultService.instance) {
      const url = process.env.AZURE_KEYVAULTURL;
      if (!url) {
        throw new Error('AZURE_KEYVAULTURL is not defined in environment variables.');
      }

      KeyVaultService.instance = new KeyVaultService(url);
    }

    return KeyVaultService.instance;
  }

  // #endregion

  // #region Secret Fetching + Caching

  /**
   * Retrieves a secret from Azure Key Vault (uses cache if within TTL).
   * @param secretName Name of the secret to retrieve
   * @returns Secret value or null if not found/error
   */
  public async getSecret(secretName: string): Promise<string | null> {
    const now = Date.now();

    // Check cache validity
    const cached = this.secretCache.get(secretName);
    if (cached?.value && now - cached.fetchedAt < this.CACHE_TTL) {
      loggerService.logger.debug(`KeyVaultService: Secret '${secretName}' returned from cache.`);
      return cached.value;
    }

    try {
      const secret = await this.client.getSecret(secretName);
      const value = secret.value || '';

      // Update cache
      this.secretCache.set(secretName, { value, fetchedAt: now });

      loggerService.logger.debug(`KeyVaultService: Secret '${secretName}' retrieved and cached.`);
      return value;
    } catch (error) {
      this.handleError(error, secretName);
      return null;
    }
  }

  // #endregion

  // #region Error Handling

  /**
   * Logs error details while fetching a secret.
   */
  private handleError(error: unknown, secretName: string): void {
    loggerService.logger.error(`KeyVaultService: Error fetching secret '${secretName}'`, {
      error: (error as Error).message ?? error,
    });
  }

  // #endregion
}

// #region Exported Helper

/**
 * Shorthand utility to fetch a secret from the singleton KeyVaultService.
 */
export async function getSecretFromKeyVault(secretName: string): Promise<string | null> {
  return await KeyVaultService.getInstance().getSecret(secretName);
}

// #endregion
