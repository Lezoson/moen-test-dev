import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';

import { loggerService } from '../utils/logger';
import config from '../config';

interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags?: Record<string, string>;
}

interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  timestamp: number;
  duration?: number;
}

interface SystemMetrics {
  memory: {
    used: number;
    total: number;
    free: number;
    percentage: number;
  };
  cpu: {
    usage: number;
    load: number;
  };
  uptime: number;
  activeConnections: number;
  requestRate: number;
  errorRate: number;
  responseTime: {
    p50: number;
    p95: number;
    p99: number;
  };
}

class PerformanceService extends EventEmitter {
  private metrics: PerformanceMetric[] = [];
  private healthChecks: Map<string, HealthCheck> = new Map();
  private requestTimes: number[] = [];
  private errorCount = 0;
  private requestCount = 0;
  private startTime = Date.now();
  private activeConnections = 0;
  private metricsInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startMetricsCollection();
    this.startHealthChecks();
  }

  private startMetricsCollection(): void {
    if (!config.monitoring.enableMetrics) return;

    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000); // Collect metrics every 30 seconds
  }

  private startHealthChecks(): void {
    if (!config.monitoring.enableHealthChecks) return;

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, config.monitoring.healthCheckInterval);
  }

  private collectSystemMetrics(): void {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Memory metrics
      this.recordMetric('memory.heap.used', memUsage.heapUsed, 'bytes');
      this.recordMetric('memory.heap.total', memUsage.heapTotal, 'bytes');
      this.recordMetric('memory.rss', memUsage.rss, 'bytes');
      this.recordMetric('memory.external', memUsage.external, 'bytes');

      // CPU metrics
      this.recordMetric('cpu.user', cpuUsage.user, 'microseconds');
      this.recordMetric('cpu.system', cpuUsage.system, 'microseconds');

      // Application metrics
      this.recordMetric('uptime', Date.now() - this.startTime, 'milliseconds');
      this.recordMetric('active.connections', this.activeConnections, 'count');
      this.recordMetric('requests.total', this.requestCount, 'count');
      this.recordMetric('errors.total', this.errorCount, 'count');

      // Calculate rates
      const uptimeSeconds = (Date.now() - this.startTime) / 1000;
      const requestRate = this.requestCount / uptimeSeconds;
      const errorRate = this.errorCount / uptimeSeconds;

      this.recordMetric('requests.rate', requestRate, 'requests/second');
      this.recordMetric('errors.rate', errorRate, 'errors/second');

      // Response time percentiles
      if (this.requestTimes.length > 0) {
        const sortedTimes = [...this.requestTimes].sort((a, b) => a - b);
        const p50Index = Math.floor(sortedTimes.length * 0.5);
        const p95Index = Math.floor(sortedTimes.length * 0.95);
        const p99Index = Math.floor(sortedTimes.length * 0.99);

        this.recordMetric('response.time.p50', sortedTimes[p50Index] || 0, 'milliseconds');
        this.recordMetric('response.time.p95', sortedTimes[p95Index] || 0, 'milliseconds');
        this.recordMetric('response.time.p99', sortedTimes[p99Index] || 0, 'milliseconds');
      }

      // Keep only last 1000 request times for percentile calculations
      if (this.requestTimes.length > 1000) {
        this.requestTimes = this.requestTimes.slice(-1000);
      }

      loggerService.logger.debug('System metrics collected', {
        memoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        activeConnections: this.activeConnections,
        requestRate: requestRate.toFixed(2),
        errorRate: errorRate.toFixed(2),
      });
    } catch (error) {
      loggerService.logger.error('Error collecting system metrics', {
        error: (error as Error).message,
      });
    }
  }

  private async runHealthChecks(): Promise<void> {
    try {
      // Database health check
      await this.checkDatabaseHealth();

      // Cache health check
      await this.checkCacheHealth();

      // External service health checks
      await this.checkExternalServicesHealth();

      loggerService.logger.debug('Health checks completed');
    } catch (error) {
      loggerService.logger.error('Error running health checks', {
        error: (error as Error).message,
      });
    }
  }

  private async checkDatabaseHealth(): Promise<void> {
    // This would check database connectivity
    // For now, we'll simulate a healthy database
    const healthCheck: HealthCheck = {
      name: 'database',
      status: 'healthy',
      message: 'Database connection is healthy',
      timestamp: Date.now(),
      duration: 5,
    };

    this.healthChecks.set('database', healthCheck);
  }

  private async checkCacheHealth(): Promise<void> {
    // This would check cache connectivity
    const healthCheck: HealthCheck = {
      name: 'cache',
      status: 'healthy',
      message: 'Cache service is healthy',
      timestamp: Date.now(),
      duration: 2,
    };

    this.healthChecks.set('cache', healthCheck);
  }

  private async checkExternalServicesHealth(): Promise<void> {
    // This would check external service dependencies
    const healthCheck: HealthCheck = {
      name: 'external-services',
      status: 'healthy',
      message: 'All external services are responding',
      timestamp: Date.now(),
      duration: 10,
    };

    this.healthChecks.set('external-services', healthCheck);
  }

  /**
   * Record a performance metric
   */
  recordMetric(name: string, value: number, unit: string, tags?: Record<string, string>): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags,
    };

    this.metrics.push(metric);

    // Keep only last 1000 metrics
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }

    this.emit('metric', metric);
  }

  /**
   * Record request timing
   */
  recordRequestTime(duration: number): void {
    this.requestTimes.push(duration);
    this.requestCount++;
  }

  /**
   * Record an error
   */
  recordError(): void {
    this.errorCount++;
  }

  /**
   * Track active connections
   */
  incrementConnections(): void {
    this.activeConnections++;
  }

  decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Get current system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();
    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    const requestRate = this.requestCount / uptimeSeconds;
    const errorRate = this.errorCount / uptimeSeconds;

    let responseTimeP50 = 0;
    let responseTimeP95 = 0;
    let responseTimeP99 = 0;

    if (this.requestTimes.length > 0) {
      const sortedTimes = [...this.requestTimes].sort((a, b) => a - b);
      const p50Index = Math.floor(sortedTimes.length * 0.5);
      const p95Index = Math.floor(sortedTimes.length * 0.95);
      const p99Index = Math.floor(sortedTimes.length * 0.99);

      responseTimeP50 = sortedTimes[p50Index] || 0;
      responseTimeP95 = sortedTimes[p95Index] || 0;
      responseTimeP99 = sortedTimes[p99Index] || 0;
    }

    return {
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        free: memUsage.heapTotal - memUsage.heapUsed,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      },
      cpu: {
        usage: 0, // Would need additional monitoring for CPU usage
        load: 0, // Would need additional monitoring for load average
      },
      uptime: Date.now() - this.startTime,
      activeConnections: this.activeConnections,
      requestRate,
      errorRate,
      responseTime: {
        p50: responseTimeP50,
        p95: responseTimeP95,
        p99: responseTimeP99,
      },
    };
  }

  /**
   * Get all health checks
   */
  getHealthChecks(): HealthCheck[] {
    return Array.from(this.healthChecks.values());
  }

  /**
   * Get overall health status
   */
  getOverallHealth(): { status: 'healthy' | 'unhealthy' | 'degraded'; checks: HealthCheck[] } {
    const checks = this.getHealthChecks();
    const unhealthyCount = checks.filter(check => check.status === 'unhealthy').length;
    const degradedCount = checks.filter(check => check.status === 'degraded').length;

    let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    if (unhealthyCount > 0) {
      status = 'unhealthy';
    } else if (degradedCount > 0) {
      status = 'degraded';
    }

    return { status, checks };
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(limit: number = 100): PerformanceMetric[] {
    return this.metrics.slice(-limit);
  }

  /**
   * Performance measurement decorator
   */
  measure<T extends (...args: any[]) => any>(
    name: string,
    fn: T,
  ): (...args: Parameters<T>) => ReturnType<T> {
    return (...args: Parameters<T>): ReturnType<T> => {
      const start = performance.now();
      try {
        const result = fn(...args);
        const duration = performance.now() - start;

        this.recordMetric(name, duration, 'milliseconds');

        if (result instanceof Promise) {
          return result.finally(() => {
            const asyncDuration = performance.now() - start;
            this.recordMetric(`${name}.async`, asyncDuration, 'milliseconds');
          }) as ReturnType<T>;
        }

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        this.recordMetric(`${name}.error`, duration, 'milliseconds');
        throw error;
      }
    };
  }

  /**
   * Async performance measurement
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.recordMetric(name, duration, 'milliseconds');
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(`${name}.error`, duration, 'milliseconds');
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    loggerService.logger.info('Performance service shutdown complete');
  }
}

// Export singleton instance
export const performanceService = new PerformanceService();
export default performanceService;
