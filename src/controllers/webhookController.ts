import { Request, Response } from 'express';
import { z } from 'zod';

import { verifySignature } from '../utils/verifySignature';
import { ErrorHandler } from '../utils/errorHandler';
import { WebhookService } from '../services/webhookService';
import { loggerService } from '../utils/logger';
import { ProofWebhookSchema, OverdueWebhookSchema } from '../schema/zodSchemas';

class WebhookController {
  // Helper to validate and verify signature
  private async validateAndVerify(
    req: Request,
    res: Response,
    schema: z.ZodSchema<any>,
    logContext: string,
  ): Promise<boolean> {
    // Validate request body structure
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      loggerService.logger.warn(`Invalid body received in ${logContext}`, {
        errors: parseResult.error.errors,
      });
      res
        .status(400)
        .json({ statusCode: 400, error: 'Invalid body', details: parseResult.error.errors });
      return false;
    }
    // Verify PageProof signature
    const isValid = await verifySignature.isRequestSignedByPageProof(req);
    if (!isValid) {
      loggerService.logger.warn(`Invalid signature in ${logContext}`, { headers: req.headers });
      res.status(403).json({ statusCode: 403, error: 'Invalid signature' });
      return false;
    }
    return true;
  }

  // #region Proof Status Endpoint
  /**
   * Handles the /proof-status webhook endpoint.
   * Verifies signature, validates body, and delegates to service.
   * @param req Express request
   * @param res Express response
   */
  async proofStatus(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      if (!(await this.validateAndVerify(req, res, ProofWebhookSchema, 'proofStatus'))) return;
      // Delegate to service
      const result = await WebhookService.handleProofStatus(req.body);
      loggerService.logger.info('proofStatus total processing time', {
        ms: Date.now() - startTime,
      });
      if (result.status !== 200) {
        res.status(result.status).json({ statusCode: result.status, error: result.error });
      } else {
        res.status(200).json({
          statusCode: 200,
          message: result.message,
          proofData: result.proofData,
        });
      }
    } catch (error) {
      loggerService.logger.error('Error in proofStatus', { error });
      return ErrorHandler.handleError(
        res,
        500,
        'Internal Server Error',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  // #endregion

  // #region Proof Overdue Endpoint
  /**
   * Handles the /overdue webhook endpoint.
   * Verifies signature, validates body, and delegates to service.
   * @param req Express request
   * @param res Express response
   */
  async proofOverdue(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      if (!(await this.validateAndVerify(req, res, OverdueWebhookSchema, 'proofOverdue'))) return;
      // Delegate to service
      const result = await WebhookService.handleProofOverdue(req.body);
      loggerService.logger.info('proofOverdue total processing time', {
        ms: Date.now() - startTime,
      });
      if (result.status !== 200) {
        res.status(result.status).json({ statusCode: result.status, error: result.error });
      } else {
        res.status(200).json({
          statusCode: 200,
          message: result.message,
          overdueData: result.overdueData,
        });
      }
    } catch (error) {
      loggerService.logger.error('Error in proofOverdue', { error });
      return ErrorHandler.handleError(
        res,
        500,
        'Internal Server Error',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  // #endregion
}
// #endregion

export const webhookController = new WebhookController();
