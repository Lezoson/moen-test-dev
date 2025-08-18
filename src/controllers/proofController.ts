import { Request, Response } from 'express';
import { z } from 'zod';

import { FileInfo } from '../middlewares/busboyMiddleware'; // Import FileInfo interface
import PageProofService from '../services/proofService';
import { Helper } from '../utils/helper';
import { ErrorHandler } from '../utils/errorHandler';
import { loggerService } from '../utils/logger';
import {
  MetadataSchema,
  FileUpload,
  ProofIdsSchema,
  OwnerEmailSchema,
  ProofIdSchema,
  WorkflowSchema,
  ArchiveProofSchema,
} from '../schema/zodSchemas';

class ProofController {
  // #region Class Constants
  private readonly BATCH_SIZE = Number(process.env.UPLOAD_BATCH_SIZE || 10);
  private readonly MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 50);
  // #endregion

  // #region Helpers

  // Parses and validates metadata from the request body
  private parseMetadata(body: unknown): z.infer<typeof MetadataSchema> {
    const rawMetadata = (body as Record<string, unknown>).metadata;
    const metadata = typeof rawMetadata === 'string' ? JSON.parse(rawMetadata) : rawMetadata;
    return MetadataSchema.parse(metadata);
  }

  // Validates files from Busboy
  private validateFiles(files: FileInfo[]): FileUpload[] {
    loggerService.logger.info('Validating files', {
      fileCount: files.length,
      maxFileSizeMB: this.MAX_FILE_SIZE_MB,
    });

    const results: FileUpload[] = [];
    for (const file of files) {
      loggerService.logger.info('Validating file', {
        fileName: file.originalname,
        fileSize: file.size,
        hasBuffer: !!file.buffer,
        bufferSize: file.buffer?.length,
        fieldname: file.fieldname,
      });

      if (!file.buffer) {
        throw ErrorHandler.createError(400, `File ${file.originalname} has no buffer content`);
      }

      const sizeMB = file.size / 1_000_000;
      if (sizeMB > this.MAX_FILE_SIZE_MB) {
        throw ErrorHandler.createError(
          400,
          `File ${file.originalname} exceeds ${this.MAX_FILE_SIZE_MB}MB limit (actual: ${sizeMB.toFixed(2)}MB)`,
        );
      }

      results.push({
        fileName: file.originalname,
        fileBuffer: file.buffer,
      });
    }

    loggerService.logger.info('File validation completed', {
      validFiles: results.length,
    });
    return results;
  }

  // Creates proofs in batches
  private async batchCreateProofs(
    fileUploads: { fileId: string; fileNames: string[] }[],
    metadata: z.infer<typeof MetadataSchema>,
    fileData: FileUpload[],
  ): Promise<{ proof: any; fileNames: string[] }[]> {
    const proofs: { proof: any; fileNames: string[] }[] = [];

    for (let i = 0; i < fileUploads.length; i += this.BATCH_SIZE) {
      const batch = fileUploads.slice(i, i + this.BATCH_SIZE);
      const batchCreated = await Promise.all(
        batch.map(({ fileId, fileNames }, idx) => {
          const index = i + idx;
          const isZipped = fileNames.length > 1 || fileNames[0].endsWith('.zip');
          const baseProofName = metadata.proofName?.trim() || 'Markups & Reference Documents';

          // Determine proof name based on documentType
          let uniqueProofName: string;
          if (metadata.documentType === 'drafts') {
            uniqueProofName = baseProofName; // Use base proof name only
          } else if (metadata.documentType === 'translated') {
            uniqueProofName = isZipped ? baseProofName : `${baseProofName}_translated`; // Append _translated
          } else {
            // Default behavior for markups
            uniqueProofName = isZipped ? baseProofName : `${baseProofName}_${fileNames[0]}`;
          }

          loggerService.logger.info('Creating proof', { proofName: uniqueProofName, fileId });

          return PageProofService.createProofs({
            ...metadata,
            proofName: uniqueProofName,
            fileIds: [{ fileId, fileNames }],
          });
        }),
      );

      proofs.push(...batchCreated.flat());
    }

    loggerService.logger.info('Batch proof creation complete', { total: proofs.length });
    return proofs;
  }

  // #endregion

  // #region Create Proof Endpoint

  /**
   * Express endpoint to create proofs in PageProof. Handles file uploads via Busboy.
   * @param req Express request
   * @param res Express response
   * @param files Files from Busboy
   */
  public createProof = async (req: Request, res: Response, files: FileInfo[]) => {
    loggerService.logger.info('createProof started', {
      fileCount: files?.length,
      files: files?.map(f => ({
        name: f.originalname,
        size: f.size,
        fieldname: f.fieldname,
        hasBuffer: !!f.buffer,
      })),
    });

    try {
      if (!files || files.length === 0) {
        loggerService.logger.error('No files provided to createProof', {
          contentType: req.headers['content-type'],
          contentLength: req.headers['content-length'],
          bodyKeys: Object.keys(req.body || {}),
        });
        throw ErrorHandler.createError(400, 'At least one file is required');
      }
      const metadata = this.parseMetadata(req.body);
      const fileData = this.validateFiles(files);
      const isIndividual = req.body.isIndividual;
      const collectionName = metadata.collectionName || 'DEFAULT_COLLECTION_NAME';

      await PageProofService.ensureCollectionExists(collectionName);

      const fileUploads = await PageProofService.uploadFiles(fileData, isIndividual);
      if (!fileUploads?.length) throw ErrorHandler.createError(500, 'File upload failed');

      metadata.dueDate =
        metadata.dueDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const proofs = await this.batchCreateProofs(fileUploads, metadata, fileData);
      if (!proofs.length) throw ErrorHandler.createError(500, 'Proof creation failed');

      // Create final response using Promise.allSettled for robustness
      const proofResponseSettled = await Promise.allSettled(
        proofs.map(async ({ proof, fileNames }, i) => {
          try {
            if (!proof?.id) {
              loggerService.logger.error('Invalid proof object', { index: i });
              return {
                proofId: null,
                proofName: proof?.name || 'Unknown',
                fileNames,
                error: 'Invalid proof object',
              };
            }

            const fileName = fileNames[0] || 'Unknown';
            const shareLink = Helper.generateProofUrl(proof.id, fileName);
            // Only set message for 'markups' documentType
            let message: string | undefined;
            if (metadata.documentType === 'markups') {
              message = metadata.messageToReviewers
                ? `${metadata.messageToReviewers}\nAccess the proof here: ${shareLink}`
                : `Access the proof here: ${shareLink}`;
            }

            return {
              proofId: proof.id,
              proofName: proof.name,
              fileNames,
              shareLink,
              isZipped: fileNames.length > 1 || fileName.endsWith('.zip'),
              message,
            };
          } catch (err) {
            loggerService.logger.error('Error generating share link', {
              proofId: proof?.id || 'unknown',
              error: (err as Error).message,
              index: i,
            });
            return {
              proofId: proof?.id || null,
              proofName: proof?.name || 'Unknown',
              fileNames,
              error: `Link/message error: ${(err as Error).message}`,
            };
          }
        }),
      );

      // Parallelize setMessageToReviewers only for proofs with a message (i.e., markups)
      await Promise.all(
        proofResponseSettled
          .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter(r => r?.proofId && r?.message) // Only process proofs with a message
          .map(r => PageProofService.setMessageToReviewers(r.proofId, r.message)),
      );

      const proofResponse = proofResponseSettled
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => {
          const { message, ...rest } = r.value;
          return rest;
        });

      return res.status(200).json({
        statusCode: 200,
        success: true,
        message: 'Proof Created Successfully.',
        proofs: proofResponse,
      });
    } catch (err) {
      loggerService.logger.error('createProof failed', { error: (err as Error).message });
      return ErrorHandler.handleError(
        res,
        (err as any).statusCode || 500,
        err.message,
        err as Error,
      );
    }
  };

  // #region Lock Proof Endpoint

  /**
   * Express endpoint to lock proofs in PageProof. Handles batch locking and error reporting.
   * @param req Express request
   * @param res Express response
   */
  public lockProof = async (req: Request, res: Response) => {
    try {
      const proofIds = ProofIdsSchema.parse(req.body.proofIds);
      if (!proofIds?.length)
        throw ErrorHandler.createError(400, 'At least one proof ID is required');

      const resultsSettled = await Promise.allSettled(
        proofIds.map(async id => {
          try {
            const details = await PageProofService.loadProofDetails(id);
            if (!details) return { proofId: id, success: false, error: 'Proof not found' };

            const locked = await PageProofService.lockProofService(id);
            return locked
              ? { proofId: id, success: true, locked }
              : { proofId: id, success: false, error: 'Lock failed' };
          } catch (err) {
            loggerService.logger.error('lockProof failed for proof', {
              proofId: id,
              error: (err as Error).message,
            });
            return { proofId: id, success: false, error: (err as Error).message };
          }
        }),
      );
      const results = resultsSettled
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value);

      const allSuccess = results.every(r => r.success);
      return res.status(allSuccess ? 200 : 207).json({
        statusCode: allSuccess ? 200 : 207,
        success: allSuccess,
        results,
      });
    } catch (err) {
      loggerService.logger.error('lockProof failed', { error: (err as Error).message });
      return ErrorHandler.handleError(
        res,
        (err as any).statusCode || 400,
        err.message,
        err as Error,
      );
    }
  };

  // #region Assign Owners Endpoint

  /**
   * Express endpoint to add owners to proofs in PageProof.
   * @param req Express request
   * @param res Express response
   */
  public addOwners = async (req: Request, res: Response) => {
    try {
      const proofIds = ProofIdsSchema.parse(req.body.proofIds);
      const email = OwnerEmailSchema.parse(req.body.ownerEmail);
      if (!proofIds?.length)
        throw ErrorHandler.createError(400, 'At least one proof ID is required');

      // First: Add new owners
      const addResults = await Promise.all(
        proofIds.map(async id => {
          try {
            const details = await PageProofService.loadProofDetails(id);
            if (!details) return { proofId: id, success: false, error: 'Proof not found' };

            const added = await PageProofService.addOwnersService(id, email);
            return added
              ? { proofId: id, success: true }
              : { proofId: id, success: false, error: 'Add owner failed' };
          } catch (err) {
            loggerService.logger.error('ProofController: addOwners error for ID', {
              proofId: id,
              error: (err as Error).message,
            });
            return { proofId: id, success: false, error: (err as Error).message };
          }
        }),
      );

      // Then: Remove old owners (only for successful add operations)
      const removeResults = await Promise.all(
        addResults.map(async result => {
          if (!result.success) return result; // Skip failed additions

          try {
            const removed = await PageProofService.removeOldOwners(result.proofId, email);
            return removed
              ? {
                  proofId: result.proofId,
                  success: true,
                  result: 'Owner updated successfully (added & removed old)',
                }
              : {
                  proofId: result.proofId,
                  success: false,
                  error: 'Owner added, but failed to remove old owners',
                };
          } catch (err) {
            loggerService.logger.error('ProofController: removeOldOwners error for ID', {
              proofId: result.proofId,
              error: (err as Error).message,
            });
            return { proofId: result.proofId, success: false, error: (err as Error).message };
          }
        }),
      );

      const allSuccess = removeResults.every(r => r.success);
      return res.status(allSuccess ? 200 : 207).json({
        statusCode: allSuccess ? 200 : 207,
        success: allSuccess,
        results: removeResults,
      });
    } catch (err) {
      loggerService.logger.error('ProofController: addOwners error', {
        error: (err as Error).message,
      });
      return ErrorHandler.handleError(
        res,
        (err as any).statusCode || 400,
        err.message,
        err as Error,
      );
    }
  };

  // #region Update Proof Endpoint

  /**
   * Express endpoint to update proofs in PageProof with new files via Busboy.
   * @param req Express request
   * @param res Express response
   * @param files Files from Busboy
   */
  public updateProof = async (req: Request, res: Response, files: FileInfo[]) => {
    loggerService.logger.info('ProofController: updateProof started', {
      proofId: req.body.proofId,
      fileCount: files?.length,
      files: files?.map(f => ({
        name: f.originalname,
        size: f.size,
        fieldname: f.fieldname,
        hasBuffer: !!f.buffer,
      })),
    });

    try {
      const proofId = ProofIdSchema.parse(req.body.proofId);
      if (!files || files.length === 0) {
        loggerService.logger.error('No files provided to updateProof', {
          contentType: req.headers['content-type'],
          contentLength: req.headers['content-length'],
          bodyKeys: Object.keys(req.body || {}),
        });
        throw ErrorHandler.createError(400, 'At least one file is required');
      }

      const fileData = this.validateFiles(files);

      const metadata = await PageProofService.loadProofDetails(proofId);
      if (!metadata) throw ErrorHandler.createError(404, 'Proof not found');
      loggerService.logger.info('ProofController: updateProof metadata', {
        metadata: {
          name: metadata.name,
          groupId: metadata.groupId,
          dueDate: metadata.dueDate,
          workflowId: metadata.workflowId,
          tags: metadata.tags,
          messageToReviewers: metadata.messageToReviewers,
        },
      });

      const fileUploads = await PageProofService.uploadFiles(fileData);
      if (!fileUploads.length) throw ErrorHandler.createError(500, 'File upload failed');
      loggerService.logger.info('ProofController: updateProof fileUploads', { fileUploads });

      if (!metadata.workflowId)
        throw ErrorHandler.createError(400, 'Workflow ID is missing in proof metadata');

      const proofData = {
        name: metadata.name,
        groupId: metadata.groupId,
        tags: metadata.tags,
        messageToReviewers: metadata.messageToReviewers,
        dueDate: new Date(metadata.dueDate).toISOString().split('T')[0],
        fileIds: fileUploads.map(({ fileId, fileNames }) => ({
          fileId,
          fileNames: fileNames ?? ['Unknown'],
        })),
        workflowId: metadata.workflowId,
      };

      loggerService.logger.info('ProofController: updateProof data', { proofData });

      const updatedProofs = await PageProofService.updateProofVersion(proofId, proofData);

      if (!updatedProofs.length) throw ErrorHandler.createError(500, 'No new versions created');

      const response = updatedProofs.map((p, i) => ({
        proofId: p.id,
        shareLink: Helper.generateProofUrl(p.id, fileUploads[i]?.fileNames?.[0] ?? 'Unknown'),
        fileNames: fileUploads[i]?.fileNames ?? ['Unknown'],
        isZipped:
          (fileUploads[i]?.fileNames?.length ?? 0) > 1 ||
          fileUploads[i]?.fileNames?.[0]?.endsWith('.zip') ||
          false,
      }));

      loggerService.logger.info('ProofController: updateProof completed', {
        proofCount: response.length,
      });
      return res.status(200).json({
        statusCode: 200,
        success: true,
        message: 'New proof version(s) created',
        proofs: response,
      });
    } catch (err) {
      loggerService.logger.error('ProofController: updateProof error', {
        error: (err as Error).message,
      });
      return ErrorHandler.handleError(
        res,
        (err as any).statusCode || 400,
        err.message,
        err as Error,
      );
    }
  };

  // #region Assign Reviewers Endpoint

  /**
   * Express endpoint to replace reviewers and approver in PageProof.
   * @param req Express request
   * @param res Express response
   */
  public replaceReviewersAndApprovers = async (req: Request, res: Response) => {
    loggerService.logger.info('replaceReviewersAndApprovers started', {
      proofIds: req.body.proofIds,
      workflow: req.body.workflow,
    });

    const proofIdsResult = ProofIdsSchema.safeParse(req.body.proofIds);
    const workflowResult = WorkflowSchema.safeParse(req.body.workflow);

    if (!proofIdsResult.success) {
      return ErrorHandler.handleError(res, 400, 'Invalid proof IDs');
    }

    if (!workflowResult.success) {
      return ErrorHandler.handleError(res, 400, 'Invalid workflow');
    }

    const proofIds = proofIdsResult.data;
    const workflow = workflowResult.data;

    if (!proofIds.length) {
      return ErrorHandler.handleError(res, 400, 'At least one proof ID is required');
    }

    if (!workflow.reviewers?.length && !workflow.approver?.length) {
      return ErrorHandler.handleError(
        res,
        400,
        'At least one of reviewers or approver must be provided',
      );
    }

    try {
      const results = await Promise.allSettled(
        proofIds.map(async proofId => {
          try {
            const details = await PageProofService.loadProofDetails(proofId);
            if (!details) throw new Error('Proof not found');

            const updated = await PageProofService.replaceReviewersAndApprovers(proofId, workflow);

            return {
              proofId,
              success: updated,
              message: updated
                ? 'Reviewers and approvers updated'
                : 'Failed to update reviewers and approvers',
            };
          } catch (error) {
            loggerService.logger.error('Failed to update proof', {
              proofId,
              error: (error as Error).message,
            });
            throw error;
          }
        }),
      );

      const formattedResults = results.map((result, index) => {
        const proofId = proofIds[index];
        return result.status === 'fulfilled'
          ? result.value
          : {
              proofId,
              success: false,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : typeof result.reason === 'string'
                    ? result.reason
                    : 'Unknown error',
            };
      });

      const allSuccess = formattedResults.every(r => r.success);

      return res.status(allSuccess ? 200 : 207).json({
        statusCode: allSuccess ? 200 : 207,
        success: allSuccess,
        message: allSuccess
          ? 'Reviewers and approvers replaced successfully'
          : 'Partial success in replacing reviewers and approvers',
        results: formattedResults,
      });
    } catch (error) {
      loggerService.logger.error('Unexpected failure in replaceReviewersAndApprovers', {
        error: (error as Error).message,
      });

      return ErrorHandler.handleError(
        res,
        (error as any).statusCode || 500,
        (error as Error).message || 'Unexpected server error',
        error as Error,
      );
    }
  };

  // #region Update Due Dates Endpoint

  /**
   * Express endpoint to update due dates for proofs in PageProof.
   * @param req Express request
   * @param res Express response
   */
  public updateDueDates = async (req: Request, res: Response) => {
    try {
      if (!req.body || !Array.isArray(req.body.proofIds) || typeof req.body.dueDate !== 'string') {
        throw ErrorHandler.createError(
          400,
          'Request body must be of the form { proofIds: string[], dueDate: string }',
        );
      }
      const updates = req.body.proofIds.map((proofId: string) => ({
        proofId,
        dueDate: req.body.dueDate,
      }));
      const proofCount = updates.length;
      loggerService.logger.info('ProofController: updateDueDates started', {
        proofCount,
        inputType: 'proofIds+dueDate',
      });

      const results = await PageProofService.updateProofDueDates(updates);
      const allSuccess = results.every(r => r.success);
      return res.status(allSuccess ? 200 : 207).json({
        statusCode: allSuccess ? 200 : 207,
        success: allSuccess,
        message: allSuccess
          ? 'Due dates updated successfully'
          : 'Partial success in updating due dates',
        results,
      });
    } catch (err) {
      loggerService.logger.error('ProofController: updateDueDates error', {
        error: (err as Error).message,
        requestBody: req.body,
      });
      return ErrorHandler.handleError(
        res,
        (err as any).statusCode || 400,
        err.message,
        err as Error,
      );
    }
  };

  // #region Archive Proof Endpoint

  /**
   * Express endpoint to archive proofs in PageProof.
   * @param req Express request
   * @param res Express response
   */
  public archiveProof = async (req: Request, res: Response) => {
    try {
      const proofIdOrIds = ArchiveProofSchema.parse(req.body.proofIds);
      const proofIds = Array.isArray(proofIdOrIds) ? proofIdOrIds : [proofIdOrIds];

      loggerService.logger.info('ProofController: archiveProof started', {
        proofCount: proofIds.length,
      });

      const results = await PageProofService.archiveProofs(proofIdOrIds);
      const allSuccess = results.every(r => r.success);

      return res.status(allSuccess ? 200 : 207).json({
        statusCode: allSuccess ? 200 : 207,
        success: allSuccess,
        message: allSuccess
          ? 'Proofs archived successfully'
          : 'Partial success in archiving proofs',
        results,
      });
    } catch (err) {
      loggerService.logger.error('ProofController: archiveProof error', {
        error: (err as Error).message,
        requestBody: req.body,
      });
      return ErrorHandler.handleError(
        res,
        (err as any).statusCode || 400,
        err.message,
        err as Error,
      );
    }
  };
}

export const proofController = new ProofController();
