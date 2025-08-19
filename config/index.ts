import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SecurityConfigSchema = z.object({
  jwtSecret: z.string().min(32),
  jwtExpiresIn: z.string().default('24h'),
  bcryptRounds: z.number().int().min(10).max(14).default(12),
  rateLimitWindowMs: z.number().int().positive().default(900000), // 15 minutes
  rateLimitMax: z.number().int().positive().default(1000), // Increased for PowerApps integration
  rateLimitMaxStrict: z.number().int().positive().default(100), // For webhook endpoints
  rateLimitEnabled: z.boolean().default(true), // Enable/disable rate limiting
  corsOrigins: z.array(z.string().url()).default(['http://localhost:3000']),
  corsCredentials: z.boolean().default(true),
  helmetEnabled: z.boolean().default(true),
  hmacSecretKey: z.string().min(32),
  hmacTimeout: z.number().int().positive().default(300000), // 5 minutes
  hmacCacheTtl: z.number().int().positive().default(60000), // 1 minute
});

const PerformanceConfigSchema = z.object({
  compressionLevel: z.number().int().min(0).max(9).default(6),
  compressionThreshold: z.number().int().positive().default(1024),
  jsonLimit: z.string().default('10mb'),
  urlencodedLimit: z.string().default('10mb'),
  staticCacheMaxAge: z.number().int().positive().default(3600),
  enableResponseCaching: z.boolean().default(false), // Disabled for webhook APIs
  cacheTtl: z.number().int().positive().default(300), // 5 minutes
  workerThreads: z.number().int().positive().default(4),
  clusterEnabled: z.boolean().default(false), // Disabled for integration APIs
  clusterWorkers: z.number().int().positive().default(4),
});

const MonitoringConfigSchema = z.object({
  enableMetrics: z.boolean().default(true),
  metricsPort: z.number().int().positive().default(9090),
  enableHealthChecks: z.boolean().default(true),
  healthCheckInterval: z.number().int().positive().default(30000),
  enableTracing: z.boolean().default(true),
  tracingSampleRate: z.number().min(0).max(1).default(0.1),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  logFormat: z.enum(['json', 'simple']).default('json'),
  enableRequestLogging: z.boolean().default(true),
  enableErrorTracking: z.boolean().default(true),
});

const AzureConfigSchema = z.object({
  keyVaultUrl: z.string().url().optional(),
  keyVaultTenantId: z.string().optional(),
  keyVaultClientId: z.string().optional(),
  keyVaultClientSecret: z.string().optional(),
  storageAccountName: z.string().optional(),
  storageAccountKey: z.string().optional(),
  storageContainerName: z.string().optional(),
});

const PowerAppsConfigSchema = z.object({
  pageProofApprovedEndpoint: z.string().url().optional(),
  timeout: z.number().int().positive().default(30000),
  retryAttempts: z.number().int().positive().default(3),
  retryDelay: z.number().int().positive().default(1000),
});

const AppConfigSchema = z.object({
  name: z.string().default('moen-server'),
  version: z.string().default('1.0.0'),
  environment: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  port: z.number().int().positive().default(8080),
  host: z.string().default('0.0.0.0'),
  baseUrl: z.string().url().optional(),
  apiPrefix: z.string().default('/api/v1'),
  enableSwagger: z.boolean().default(false),
  swaggerPath: z.string().default('/api-docs'),
  gracefulShutdownTimeout: z.number().int().positive().default(30000),
  maxRequestBodySize: z.string().default('10mb'),
  trustProxy: z.boolean().default(false),
  temp: z.string().default('/tmp'),
});

// Main configuration schema
const ConfigSchema = z.object({
  app: AppConfigSchema,
  security: SecurityConfigSchema,
  performance: PerformanceConfigSchema,
  monitoring: MonitoringConfigSchema,
  azure: AzureConfigSchema,
  powerApps: PowerAppsConfigSchema,
});

// Configuration class with validation and type safety
class Config {
  private config: z.infer<typeof ConfigSchema>;

  constructor() {
    try {
      this.config = this.loadConfig();
    } catch (error) {
      console.error('Configuration loading failed:', error);
      console.error('Please check your environment variables and configuration.');
      process.exit(1);
    }
  }

  private loadConfig(): z.infer<typeof ConfigSchema> {
    const config = {
      app: {
        name: process.env.APP_NAME || 'moen-server',
        version: process.env.APP_VERSION || '1.0.0',
        environment: (process.env.NODE_ENV as any) || 'development',
        port: parseInt(process.env.PORT || '8080', 10),
        host: process.env.HOST || '0.0.0.0',
        baseUrl: process.env.BASE_URL,
        apiPrefix: process.env.API_PREFIX || '/api/v1',
        enableSwagger: process.env.ENABLE_SWAGGER === 'true',
        swaggerPath: process.env.SWAGGER_PATH || '/api-docs',
        gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '30000', 10),
        maxRequestBodySize: process.env.MAX_REQUEST_BODY_SIZE || '10mb',
        trustProxy: process.env.TRUST_PROXY === 'true',
        temp: process.env.TEMP_DIR,
      },
      security: {
        jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
        rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
        rateLimitMaxStrict: parseInt(process.env.RATE_LIMIT_MAX_STRICT || '100', 10),
        corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
        corsCredentials: process.env.CORS_CREDENTIALS !== 'false',
        helmetEnabled: process.env.HELMET_ENABLED !== 'false',
        hmacSecretKey: process.env.HMAC_SECRET_KEY || 'your-hmac-secret-key-change-in-production',
        hmacTimeout: parseInt(process.env.HMAC_TIMEOUT || '300000', 10),
        hmacCacheTtl: parseInt(process.env.HMAC_CACHE_TTL || '60000', 10),
      },
      performance: {
        compressionLevel: parseInt(process.env.COMPRESSION_LEVEL || '6', 10),
        compressionThreshold: parseInt(process.env.COMPRESSION_THRESHOLD || '1024', 10),
        jsonLimit: process.env.JSON_LIMIT || '10mb',
        urlencodedLimit: process.env.URLENCODED_LIMIT || '10mb',
        staticCacheMaxAge: parseInt(process.env.STATIC_CACHE_MAX_AGE || '3600', 10),
        enableResponseCaching: process.env.ENABLE_RESPONSE_CACHING !== 'false',
        cacheTtl: parseInt(process.env.CACHE_TTL || '300', 10),
        workerThreads: parseInt(process.env.WORKER_THREADS || '4', 10),
        clusterEnabled: process.env.CLUSTER_ENABLED === 'true',
        clusterWorkers: parseInt(process.env.CLUSTER_WORKERS || '4', 10),
      },
      monitoring: {
        enableMetrics: process.env.ENABLE_METRICS !== 'false',
        metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),
        enableHealthChecks: process.env.ENABLE_HEALTH_CHECKS !== 'false',
        healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10),
        enableTracing: process.env.ENABLE_TRACING !== 'false',
        tracingSampleRate: parseFloat(process.env.TRACING_SAMPLE_RATE || '0.1'),
        logLevel: (process.env.LOG_LEVEL as any) || 'info',
        logFormat: (process.env.LOG_FORMAT as any) || 'json',
        enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING !== 'false',
        enableErrorTracking: process.env.ENABLE_ERROR_TRACKING !== 'false',
      },
      azure: {
        keyVaultUrl: process.env.AZURE_KEY_VAULT_URL || undefined,
        keyVaultTenantId: process.env.AZURE_TENANT_ID || undefined,
        keyVaultClientId: process.env.AZURE_CLIENT_ID || undefined,
        keyVaultClientSecret: process.env.AZURE_CLIENT_SECRET || undefined,
        storageAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || undefined,
        storageAccountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY || undefined,
        storageContainerName: process.env.AZURE_STORAGE_CONTAINER_NAME || undefined,
      },
      powerApps: {
        pageProofApprovedEndpoint: process.env.POWERAPPS_PAGEPROOF_PAGEAPPROVED || undefined,
        timeout: parseInt(process.env.POWERAPPS_TIMEOUT || '30000', 10),
        retryAttempts: parseInt(process.env.POWERAPPS_RETRY_ATTEMPTS || '3', 10),
        retryDelay: parseInt(process.env.POWERAPPS_RETRY_DELAY || '1000', 10),
      },
    };

    // Validate configuration
    const validatedConfig = ConfigSchema.parse(config);
    return validatedConfig;
  }

  // Getters for type-safe access
  get app() {
    return this.config.app;
  }
  get security() {
    return this.config.security;
  }
  get performance() {
    return this.config.performance;
  }
  get monitoring() {
    return this.config.monitoring;
  }
  get azure() {
    return this.config.azure;
  }
  get powerApps() {
    return this.config.powerApps;
  }

  // Helper methods
  isDevelopment(): boolean {
    return this.config.app.environment === 'development';
  }

  isProduction(): boolean {
    return this.config.app.environment === 'production';
  }

  isStaging(): boolean {
    return this.config.app.environment === 'staging';
  }

  isTest(): boolean {
    return this.config.app.environment === 'test';
  }

  // Get full configuration object
  getAll(): z.infer<typeof ConfigSchema> {
    return { ...this.config };
  }
}

// Export singleton instance
export const config = new Config();
export default config;
