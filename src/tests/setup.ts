import request from 'supertest';
import express from 'express';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '8080';
process.env.HMAC_SECRET_KEY = 'test-secret-key';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.POWERAPPS_PAGEPROOF_APPROVED_ENDPOINT = 'https://test-powerapps.com/api';

// Mock config before importing it
jest.mock('../config', () => ({
  config: {
    app: {
      name: 'test-app',
      version: '1.0.0',
      environment: 'test',
      port: 8080,
      host: '0.0.0.0',
      baseUrl: 'http://localhost:8080',
      apiPrefix: '/api/v1',
      enableSwagger: false,
      swaggerPath: '/api-docs',
      gracefulShutdownTimeout: 30000,
      maxRequestBodySize: '10mb',
      trustProxy: false,
    },
    security: {
      jwtSecret: 'test-jwt-secret',
      jwtExpiresIn: '24h',
      bcryptRounds: 12,
      rateLimitWindowMs: 900000,
      rateLimitMax: 1000,
      rateLimitMaxStrict: 100,
      corsOrigins: ['http://localhost:3000'],
      corsCredentials: true,
      helmetEnabled: true,
      hmacSecretKey: 'test-secret-key',
      hmacTimeout: 300000,
      hmacCacheTtl: 60000,
    },
    performance: {
      compressionLevel: 6,
      compressionThreshold: 1024,
      jsonLimit: '10mb',
      urlencodedLimit: '10mb',
      staticCacheMaxAge: 3600,
      enableResponseCaching: false,
      cacheTtl: 300,
      workerThreads: 4,
      clusterEnabled: false,
      clusterWorkers: 4,
    },
    monitoring: {
      enableMetrics: true,
      metricsPort: 9090,
      enableHealthChecks: true,
      healthCheckInterval: 30000,
      enableTracing: false,
      tracingSampleRate: 0.1,
      logLevel: 'info',
      logFormat: 'json',
      enableRequestLogging: true,
      enableErrorTracking: true,
    },
    azure: {
      keyVaultUrl: undefined as string | undefined,
      keyVaultTenantId: undefined as string | undefined,
      keyVaultClientId: undefined as string | undefined,
      keyVaultClientSecret: undefined as string | undefined,
      storageAccountName: undefined as string | undefined,
      storageAccountKey: undefined as string | undefined,
      storageContainerName: undefined as string | undefined,
    },
    powerApps: {
      pageProofApprovedEndpoint: 'https://test-powerapps.com/api',
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
    },
  },
}));

// Mock services
jest.mock('../services/hmacService', () => ({
  hmacService: {
    validateSecret: jest.fn().mockResolvedValue(true),
    generateSignature: jest.fn().mockResolvedValue('test-signature'),
    verifySignature: jest.fn().mockResolvedValue({ isValid: true, reason: null }),
    generateHmac: jest.fn().mockResolvedValue('test-hmac'),
  },
}));

jest.mock('../services/pageProofAuthService', () => ({
  pageProofAuthService: {
    getAccessToken: jest.fn().mockResolvedValue('test-token'),
  },
}));

jest.mock('../services/proofService', () => ({
  default: {
    createProof: jest.fn().mockResolvedValue({ success: true, proofId: 'test-proof-123' }),
    lockProof: jest.fn().mockResolvedValue({ success: true }),
    addOwners: jest.fn().mockResolvedValue({ success: true }),
    updateProof: jest.fn().mockResolvedValue({ success: true }),
    replaceReviewersAndApprovers: jest.fn().mockResolvedValue({ success: true }),
    updateDueDates: jest.fn().mockResolvedValue({ success: true }),
    archiveProof: jest.fn().mockResolvedValue({ success: true }),
    getProofsInGroup: jest.fn().mockResolvedValue([
      {
        id: 'test-proof-1',
        name: 'Test Proof 1',
        state: 'in_proofing',
        dueDate: '2024-12-31T23:59:59Z',
      },
      {
        id: 'test-proof-2',
        name: 'Test Proof 2',
        state: 'approved',
        dueDate: '2024-12-31T23:59:59Z',
      },
    ]),
    loadProofDetails: jest.fn().mockResolvedValue({
      id: 'test-proof-123',
      name: 'Test Proof',
      state: 'in_proofing',
      groupId: 'test-group-123',
      dueDate: '2024-12-31T23:59:59Z',
    }),
    getGroupById: jest.fn().mockResolvedValue({ name: 'Test Group' }),
  },
}));

jest.mock('../services/powerAppsService', () => ({
  PowerAppsService: {
    sendToPowerApps: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../services/cacheService', () => ({
  cacheService: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    isCacheConnected: jest.fn().mockReturnValue(true),
    getStats: jest.fn().mockReturnValue({ 
      hits: 0, 
      misses: 0, 
      size: 0, 
      keys: 0, 
      memory: 1024 
    }),
    shutdown: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/performanceService', () => ({
  performanceService: {
    recordMetric: jest.fn(),
    recordRequestTime: jest.fn(),
    recordError: jest.fn(),
    incrementConnections: jest.fn(),
    decrementConnections: jest.fn(),
    getSystemMetrics: jest.fn().mockReturnValue({
      memory: { 
        used: 100 * 1024 * 1024, 
        total: 1000 * 1024 * 1024, 
        free: 900 * 1024 * 1024, 
        percentage: 10 
      },
      cpu: { usage: 50, load: 0.5 },
      uptime: 3600,
      activeConnections: 5,
      requestRate: 10,
      errorRate: 0.1,
      responseTime: { p50: 100, p95: 200, p99: 500 },
    }),
    getOverallHealth: jest.fn().mockReturnValue({ 
      status: 'healthy', 
      checks: [
        { name: 'cache', status: 'healthy', message: 'Cache is healthy', timestamp: Date.now() },
        { name: 'database', status: 'healthy', message: 'Database is healthy', timestamp: Date.now() },
        { name: 'external', status: 'healthy', message: 'External services are healthy', timestamp: Date.now() }
      ] 
    }),
    getHealthChecks: jest.fn().mockReturnValue([
      { name: 'cache', status: 'healthy', message: 'Cache is healthy', timestamp: Date.now() },
      { name: 'database', status: 'healthy', message: 'Database is healthy', timestamp: Date.now() },
      { name: 'external', status: 'healthy', message: 'External services are healthy', timestamp: Date.now() }
    ]),
    getRecentMetrics: jest.fn().mockReturnValue([]),
    measureAsync: jest.fn().mockImplementation(async (name, fn) => await fn()),
    shutdown: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../utils/verifySignature', () => ({
  isRequestSignedByPageProof: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/webhookService', () => ({
  webhookService: {
    handleProofStatus: jest.fn().mockResolvedValue({
      success: true,
      proofData: { id: 'test-proof-123', status: 'in_proofing' },
      inproofingData: { proofId: 'test-proof-123', status: 'in_proofing' },
    }),
    handleProofOverdue: jest.fn().mockResolvedValue({
      success: true,
      overdueData: { id: 'test-proof-456', status: 'overdue' },
    }),
  },
  WebhookService: {
    handleProofStatus: jest.fn().mockResolvedValue({
      success: true,
      proofData: { id: 'test-proof-123', status: 'in_proofing' },
      inproofingData: { proofId: 'test-proof-123', status: 'in_proofing' },
    }),
    handleProofOverdue: jest.fn().mockResolvedValue({
      success: true,
      overdueData: { id: 'test-proof-456', status: 'overdue' },
    }),
  },
}));

// Mock logger to avoid console output during tests
jest.mock('../utils/logger', () => ({
  loggerService: {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  },
}));

// Test utilities
export const createTestApp = () => {
  const app = express();

  // Add basic middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  return app;
};

export const createAuthenticatedRequest = (app: express.Application) => {
  return request(app)
    .set('x-secret-key', 'test-secret-key')
    .set('x-timestamp', Date.now().toString())
    .set('x-signature', 'test-signature');
};

export const createWebhookRequest = (app: express.Application) => {
  return request(app)
    .set('Content-Type', 'application/json')
    .set('x-timestamp', Date.now().toString())
    .set('x-signature', 'test-signature');
};

// Test data
export const testProofData = {
  proof: {
    id: 'test-proof-123',
    name: 'Test Document - Markups and Reference',
    status: 'in_proofing',
    dueDate: '2024-12-31T23:59:59Z',
    approvedDate: 'null',
  },
  trigger: {
    email: 'reviewer@example.com',
  },
};

export const testOverdueData = {
  proof: {
    id: 'test-proof-456',
    name: 'Overdue Document',
    status: 'in_proofing',
    dueDate: '2023-01-01T00:00:00Z',
  },
};

export const testMetadata = {
  proofName: 'Test Proof',
  collectionName: 'Test Collection',
  tags: ['test', 'markup'],
  messageToReviewers: 'Please review this document',
  documentType: 'markups' as const,
  dueDate: '2024-12-31T23:59:59Z',
  workflow: {
    name: 'Test Workflow',
    reviewers: ['reviewer@example.com'],
    approver: ['approver@example.com'],
    stepDueDate: '2024-12-31T23:59:59Z',
  },
  owners: ['owner@example.com'],
};

// Helper functions
export const generateTestFile = (filename: string, content: string = 'test content') => {
  return Buffer.from(content);
};

export const waitForAsync = (ms: number = 100) => new Promise(resolve => setTimeout(resolve, ms));

// Global test setup
beforeAll(() => {
  // Silence console output during tests
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
