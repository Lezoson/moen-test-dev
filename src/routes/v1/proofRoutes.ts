import fs from 'fs';
import { promisify } from 'util';

import { Router, Request, Response, NextFunction } from 'express';

import { busboyUpload } from '../../middlewares/busboyMiddleware'; // Assuming busboyUpload is in a separate file
import { proofController } from '../../controllers/proofController';
import { hmacValidator } from '../../middlewares/hmacMiddleware';
import { FileInfo } from '../../middlewares/busboyMiddleware'; // Import FileInfo interface
import { loggerService } from '../../utils/logger';

const unlinkAsync = promisify(fs.unlink);

const router = Router();

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// File upload configuration for Busboy
const uploadConfig = {
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB per file
    files: 10, // Max 10 files per upload
  },
};

// Helper to clean up temporary files
const cleanupFiles = async (files: FileInfo[]) => {
  await Promise.all(
    files
      .filter(file => file.path && file.path !== '')
      .map(file =>
        unlinkAsync(file.path).catch(err => {
          loggerService.logger.error(`Failed to delete temp file ${file.path}:`, err);
        }),
      ),
  );
};

// Create Proof with File Upload
router.post(
  '/create-proof',
  hmacValidator.verify,
  busboyUpload(uploadConfig),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const files = (req as any).files as FileInfo[];
    try {
      await proofController.createProof(req, res, files);
    } finally {
      await cleanupFiles(files);
    }
  }),
);
// Lock Proof
router.post(
  '/lock-proof',
  hmacValidator.verify,
  asyncHandler(proofController.lockProof.bind(proofController)),
);

// Assign Owners
router.post(
  '/assign-owners',
  hmacValidator.verify,
  asyncHandler(proofController.addOwners.bind(proofController)),
);

// Update Proof with File Upload
router.post(
  '/update-proof',
  hmacValidator.verify,
  busboyUpload(uploadConfig),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const files = (req as any).files as FileInfo[];
    try {
      await proofController.updateProof(req, res, files);
    } finally {
      await cleanupFiles(files);
    }
  }),
);

// Assign Reviewers
router.post(
  '/assign-reviewers',
  hmacValidator.verify,
  asyncHandler(proofController.replaceReviewersAndApprovers.bind(proofController)),
);

// Update Due Dates
router.post(
  '/update-due-dates',
  hmacValidator.verify,
  asyncHandler(proofController.updateDueDates.bind(proofController)),
);

// Archive Proof
router.post(
  '/archive-proof',
  hmacValidator.verify,
  asyncHandler(proofController.archiveProof.bind(proofController)),
);

export default router;
