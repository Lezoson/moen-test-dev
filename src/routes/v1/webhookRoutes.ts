import { Router, Request, Response, NextFunction } from 'express';

import { webhookController } from '../../controllers/webhookController';
import { performanceService } from '../../services/performanceService';
import { cacheService } from '../../services/cacheService';
import { loggerService } from '../../utils/logger';

const router = Router();

// Performance monitoring wrapper for webhooks
const withWebhookPerformanceMonitoring = (operationName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = (req as any).requestId || `webhook-${Date.now()}`;

    try {
      loggerService.logger.info(`Webhook ${operationName} started`, {
        requestId,
        url: req.originalUrl,
        method: req.method,
        contentLength: req.get('Content-Length'),
        userAgent: req.get('User-Agent'),
      });

      // Execute the webhook handler with performance monitoring
      await performanceService.measureAsync(`webhook.${operationName}`, async () => {
        if (operationName === 'proofStatus') {
          await webhookController.proofStatus(req, res);

          // Log inproofing status specifically
          if (req.body?.proof?.status === 'in_proofing') {
            loggerService.logger.info('Inproofing status received', {
              requestId,
              proofId: req.body?.proof?.id,
              proofName: req.body?.proof?.name,
              dueDate: req.body?.proof?.dueDate,
            });
          }
        } else if (operationName === 'proofOverdue') {
          await webhookController.proofOverdue(req, res);
        }
      });

      const duration = Date.now() - startTime;
      loggerService.logger.info(`Webhook ${operationName} completed`, {
        requestId,
        duration,
        statusCode: res.statusCode,
      });

      // Record performance metrics
      performanceService.recordMetric(
        `webhook.${operationName}.duration`,
        duration,
        'milliseconds',
        {
          statusCode: res.statusCode.toString(),
          success: res.statusCode < 400 ? 'true' : 'false',
        },
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      loggerService.logger.error(`Webhook ${operationName} failed`, {
        requestId,
        error: (error as Error).message,
        duration,
        url: req.originalUrl,
        method: req.method,
      });

      // Record error metrics
      performanceService.recordError();
      performanceService.recordMetric(`webhook.${operationName}.error`, duration, 'milliseconds');

      // Send error response if not already sent
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Webhook processing failed',
          requestId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  };
};

// Middleware to capture raw body for signature verification
export function rawBodySaver(req: Request, res: Response, buf: Buffer, encoding: string) {
  if (buf && buf.length) {
    (req as any).rawBody = buf.toString((encoding || 'utf8') as BufferEncoding);
  }
}

// Optimized webhook routes with performance monitoring
router.post('/proof-status', withWebhookPerformanceMonitoring('proofStatus'));
router.post('/overdue', withWebhookPerformanceMonitoring('proofOverdue'));

// Add health check for webhook service
router.get('/health', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();

    const response = {
      status: 'healthy',
      service: 'webhook',
      responseTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      cache: {
        connected: cacheService.isCacheConnected(),
        stats: cacheService.getStats(),
      },
      performance: {
        metrics: performanceService.getSystemMetrics(),
      },
      endpoints: {
        proofStatus: '/api/v1/webhook/proof-status',
        overdue: '/api/v1/webhook/overdue',
      },
    };

    res.status(200).json(response);
  } catch (error) {
    loggerService.logger.error('Webhook health check failed', { error: (error as Error).message });
    res.status(503).json({
      status: 'unhealthy',
      service: 'webhook',
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Add webhook statistics endpoint
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const metrics = performanceService.getSystemMetrics();
    const recentMetrics = performanceService.getRecentMetrics(100);

    // Filter webhook-related metrics
    const webhookMetrics = recentMetrics.filter(metric => metric.name.startsWith('webhook.'));

    const response = {
      timestamp: new Date().toISOString(),
      webhookMetrics,
      systemMetrics: {
        requestRate: metrics.requestRate,
        errorRate: metrics.errorRate,
        responseTime: metrics.responseTime,
      },
      cache: {
        connected: cacheService.isCacheConnected(),
        stats: cacheService.getStats(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    loggerService.logger.error('Webhook stats failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve webhook statistics',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
