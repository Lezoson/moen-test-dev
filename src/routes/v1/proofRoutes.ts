import fs from 'fs';
import { promisify } from 'util';

import { Router, Request, Response, NextFunction } from 'express';

import { busboyUpload } from '../../middlewares/busboyMiddleware';
import { proofController } from '../../controllers/proofController';
import { hmacValidator } from '../../middlewares/hmacMiddleware';
import { FileInfo } from '../../middlewares/busboyMiddleware';
import { performanceService } from '../../services/performanceService';
import { loggerService } from '../../utils/logger';

const unlinkAsync = promisify(fs.unlink);

const router = Router();

// Enhanced async handler with performance monitoring
const asyncHandler = (operationName: string) => {
  return (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      return performanceService.measureAsync(`${operationName}.total`, async () => {
        try {
          await fn(req, res, next);
        } catch (error) {
          loggerService.logger.error(`Error in ${operationName}`, {
            error: (error as Error).message,
            url: req.originalUrl,
            method: req.method,
            ip: req.ip,
          });
          next(error);
        }
      });
    };
};

// Optimized file upload configuration
const uploadConfig = {
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB per file
    files: 10, // Max 10 files per upload
  },
  // Add performance optimizations
  highWaterMark: 64 * 1024, // 64KB chunks for better memory usage
  preservePath: false, // Don't preserve full path for security
};

// Enhanced file cleanup with better error handling
const cleanupFiles = async (files: FileInfo[]) => {
  if (!files || files.length === 0) return;

  const cleanupPromises = files
    .filter(file => file.path && file.path !== '')
    .map(async file => {
      try {
        await unlinkAsync(file.path);
        loggerService.logger.debug('Temporary file cleaned up', { path: file.path });
      } catch (err) {
        loggerService.logger.warn(`Failed to delete temp file ${file.path}:`, {
          error: (err as Error).message,
        });
      }
    });

  await Promise.allSettled(cleanupPromises);
};

// Optimized file upload handler with performance monitoring
const fileUploadHandler = (operationName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const files = (req as any).files as FileInfo[];
    const startTime = Date.now();

    try {
      loggerService.logger.info(`Starting ${operationName}`, {
        fileCount: files?.length || 0,
        totalSize: files?.reduce((sum, file) => sum + (file.size || 0), 0) || 0,
      });

      // Execute the operation
      if (operationName === 'createProof') {
        await proofController.createProof(req, res, files);
      } else if (operationName === 'updateProof') {
        await proofController.updateProof(req, res, files);
      }

      loggerService.logger.info(`${operationName} completed`, {
        duration: Date.now() - startTime,
        fileCount: files?.length || 0,
      });
    } catch (error) {
      loggerService.logger.error(`${operationName} failed`, {
        error: (error as Error).message,
        duration: Date.now() - startTime,
        fileCount: files?.length || 0,
      });
      throw error;
    } finally {
      // Always cleanup files
      await cleanupFiles(files);
    }
  };
};

// Create Proof with File Upload - Optimized
router.post(
  '/create-proof',
  hmacValidator.verify,
  busboyUpload(uploadConfig),
  asyncHandler('createProof')(fileUploadHandler('createProof')),
);

// Lock Proof - Optimized
router.post(
  '/lock-proof',
  hmacValidator.verify,
  asyncHandler('lockProof')(proofController.lockProof.bind(proofController)),
);

// Assign Owners - Optimized
router.post(
  '/assign-owners',
  hmacValidator.verify,
  asyncHandler('assignOwners')(proofController.addOwners.bind(proofController)),
);

// Update Proof with File Upload - Optimized
router.post(
  '/update-proof',
  hmacValidator.verify,
  busboyUpload(uploadConfig),
  asyncHandler('updateProof')(fileUploadHandler('updateProof')),
);

// Assign Reviewers - Optimized
router.post(
  '/assign-reviewers',
  hmacValidator.verify,
  asyncHandler('assignReviewers')(
    proofController.replaceReviewersAndApprovers.bind(proofController),
  ),
);

// Update Due Dates - Optimized
router.post(
  '/update-due-dates',
  hmacValidator.verify,
  asyncHandler('updateDueDates')(proofController.updateDueDates.bind(proofController)),
);

// Archive Proof - Optimized
router.post(
  '/archive-proof',
  hmacValidator.verify,
  asyncHandler('archiveProof')(proofController.archiveProof.bind(proofController)),
);

export default router;
