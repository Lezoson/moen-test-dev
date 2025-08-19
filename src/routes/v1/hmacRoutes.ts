import { Router, Request, Response, NextFunction } from 'express';

import { hmacController } from '../../controllers/hmacController';
import { performanceService } from '../../services/performanceService';
import { cacheService } from '../../services/cacheService';
import { loggerService } from '../../utils/logger';

const router = Router();

// Performance monitoring wrapper
const withPerformanceMonitoring = (operationName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = performanceService.measureAsync(`${operationName}.total`, async () => {
      try {
        // Check cache first for GET requests
        if (req.method === 'GET') {
          const cacheKey = `hmac:${req.originalUrl}:${JSON.stringify(req.query)}`;
          const cachedResult = await cacheService.get(cacheKey, { prefix: 'hmac', ttl: 300 });

          if (cachedResult) {
            loggerService.logger.debug('HMAC cache hit', { operation: operationName });
            return res.status(200).json(cachedResult);
          }
        }

        // Execute the original handler
        if (operationName === 'generateHmacSignature') {
          await hmacController.generateHmacSignature(req, res);
        }

        // Cache successful responses
        if (req.method === 'GET' && res.statusCode === 200) {
          const cacheKey = `hmac:${req.originalUrl}:${JSON.stringify(req.query)}`;
          const responseData = res.locals.responseData || { success: true };
          await cacheService.set(cacheKey, responseData, { prefix: 'hmac', ttl: 300 });
        }
      } catch (error) {
        loggerService.logger.error(`Error in ${operationName}`, {
          error: (error as Error).message,
          url: req.originalUrl,
          method: req.method,
        });
        throw error;
      }
    });
  };
};

// Optimized HMAC generation with caching
router.get('/generate-hmac', withPerformanceMonitoring('generateHmacSignature'));

export default router;
