import { loggerService } from '../utils/logger';
import config from '../config';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

interface CacheOptions {
  ttl?: number;
  prefix?: string;
  serialize?: boolean;
}

interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  memory: number;
  uptime: number;
}

class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    keys: 0,
    memory: 0,
    uptime: Date.now(),
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxSize = 10000; // Maximum number of cache entries
  private readonly defaultTtl = config.performance.cacheTtl * 1000; // Convert to milliseconds

  constructor() {
    this.startCleanupInterval();
    this.startStatsCollection();
  }

  private startCleanupInterval(): void {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupExpiredEntries();
      },
      5 * 60 * 1000,
    );
  }

  private startStatsCollection(): void {
    // Update stats every 30 seconds
    setInterval(() => {
      this.updateStats();
    }, 30000);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.ttl > 0 && now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      loggerService.logger.debug('Cache cleanup completed', { cleanedCount });
    }
  }

  private updateStats(): void {
    this.stats.keys = this.cache.size;
    this.stats.memory = this.estimateMemoryUsage();
    this.stats.uptime = Date.now();
  }

  private estimateMemoryUsage(): number {
    let size = 0;
    for (const [key, entry] of this.cache.entries()) {
      size += key.length * 2; // UTF-16 characters
      size += JSON.stringify(entry.value).length * 2;
      size += 24; // Timestamp and TTL (8 bytes each)
    }
    return size;
  }

  private evictIfNeeded(): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entries (LRU-like eviction)
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

      const toRemove = Math.floor(this.maxSize * 0.1); // Remove 10% of entries
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
      }

      loggerService.logger.debug('Cache eviction completed', { removed: toRemove });
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
    try {
      const { ttl = this.defaultTtl, prefix = '', serialize = true } = options;
      const fullKey = prefix ? `${prefix}:${key}` : key;
      const serializedValue = serialize ? JSON.parse(JSON.stringify(value)) : value; // Deep clone

      this.evictIfNeeded();

      this.cache.set(fullKey, {
        value: serializedValue,
        timestamp: Date.now(),
        ttl: ttl,
      });

      loggerService.logger.debug('Cache set', { key: fullKey, ttl });
      return true;
    } catch (error) {
      loggerService.logger.error('Cache set error', { key, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T = any>(key: string, options: CacheOptions = {}): Promise<T | null> {
    try {
      const { prefix = '', serialize = true } = options;
      const fullKey = prefix ? `${prefix}:${key}` : key;

      const entry = this.cache.get(fullKey);

      if (!entry) {
        this.stats.misses++;
        loggerService.logger.debug('Cache miss', { key: fullKey });
        return null;
      }

      // Check if entry is expired
      if (entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl) {
        this.cache.delete(fullKey);
        this.stats.misses++;
        loggerService.logger.debug('Cache expired', { key: fullKey });
        return null;
      }

      this.stats.hits++;
      loggerService.logger.debug('Cache hit', { key: fullKey });

      return serialize ? JSON.parse(JSON.stringify(entry.value)) : entry.value; // Deep clone
    } catch (error) {
      loggerService.logger.error('Cache get error', { key, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string, prefix?: string): Promise<boolean> {
    try {
      const fullKey = prefix ? `${prefix}:${key}` : key;
      const deleted = this.cache.delete(fullKey);

      loggerService.logger.debug('Cache delete', { key: fullKey, deleted });
      return deleted;
    } catch (error) {
      loggerService.logger.error('Cache delete error', { key, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string, prefix?: string): Promise<boolean> {
    try {
      const fullKey = prefix ? `${prefix}:${key}` : key;
      const entry = this.cache.get(fullKey);

      if (!entry) return false;

      // Check if entry is expired
      if (entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl) {
        this.cache.delete(fullKey);
        return false;
      }

      return true;
    } catch (error) {
      loggerService.logger.error('Cache exists error', { key, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async mset(keyValues: Record<string, any>, options: CacheOptions = {}): Promise<boolean> {
    try {
      const { ttl = this.defaultTtl, prefix = '', serialize = true } = options;

      for (const [key, value] of Object.entries(keyValues)) {
        await this.set(key, value, { ttl, prefix, serialize });
      }

      loggerService.logger.debug('Cache mset', { keys: Object.keys(keyValues).length });
      return true;
    } catch (error) {
      loggerService.logger.error('Cache mset error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get multiple values by keys
   */
  async mget<T = any>(keys: string[], options: CacheOptions = {}): Promise<(T | null)[]> {
    try {
      const results: (T | null)[] = [];

      for (const key of keys) {
        const value = await this.get<T>(key, options);
        results.push(value);
      }

      return results;
    } catch (error) {
      loggerService.logger.error('Cache mget error', { error: (error as Error).message });
      return keys.map(() => null as T | null);
    }
  }

  /**
   * Increment a numeric value
   */
  async increment(
    key: string,
    amount: number = 1,
    options: CacheOptions = {},
  ): Promise<number | null> {
    try {
      const { prefix = '' } = options;
      const fullKey = prefix ? `${prefix}:${key}` : key;

      const currentValue = await this.get<number>(key, { ...options, serialize: false });
      const newValue = (currentValue || 0) + amount;

      await this.set(key, newValue, { ...options, serialize: false });

      loggerService.logger.debug('Cache increment', { key: fullKey, amount, result: newValue });
      return newValue;
    } catch (error) {
      loggerService.logger.error('Cache increment error', { key, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Set expiration time for a key
   */
  async expire(key: string, ttl: number, prefix?: string): Promise<boolean> {
    try {
      const fullKey = prefix ? `${prefix}:${key}` : key;
      const entry = this.cache.get(fullKey);

      if (!entry) {
        return false;
      }

      entry.ttl = ttl;
      entry.timestamp = Date.now(); // Reset timestamp

      loggerService.logger.debug('Cache expire', { key: fullKey, ttl });
      return true;
    } catch (error) {
      loggerService.logger.error('Cache expire error', { key, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async ttl(key: string, prefix?: string): Promise<number> {
    try {
      const fullKey = prefix ? `${prefix}:${key}` : key;
      const entry = this.cache.get(fullKey);

      if (!entry) {
        return -2; // Key doesn't exist
      }

      if (entry.ttl <= 0) {
        return -1; // No expiration
      }

      const remaining = entry.ttl - (Date.now() - entry.timestamp);
      return Math.max(0, Math.floor(remaining / 1000)); // Return in seconds
    } catch (error) {
      loggerService.logger.error('Cache ttl error', { key, error: (error as Error).message });
      return -2;
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<boolean> {
    try {
      this.cache.clear();
      loggerService.logger.info('Cache cleared');
      return true;
    } catch (error) {
      loggerService.logger.error('Cache clear error', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Check if cache is connected (always true for in-memory cache)
   */
  isCacheConnected(): boolean {
    return true;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.cache.clear();
    loggerService.logger.info('Cache service shutdown complete');
  }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;
