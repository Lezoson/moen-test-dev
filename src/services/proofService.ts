import { z } from 'zod';

import { loggerService } from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';
import {
  FileUpload,
  ProofData,
  FileUploadSchema,
  CollectionNameSchema,
  WorkflowSchema,
  ProofIdSchema,
  ProofDataSchema,
  OwnerEmailSchema,
  ExistingProofData,
  ExistingProofDataSchema,
  DueDateUpdateSchema,
  ArchiveProofSchema,
} from '../schema/zodSchemas';
import { Helper } from '../utils/helper';

import { PageProofAuthService } from './pageProofAuthService';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class PageProofService {
  // #region Class Variables
  private pageProofClientPromise: Promise<any> | null = null;
  private collectionCache: Map<string, { promise: Promise<any>; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = Number(process.env.COLLECTION_CACHE_TTL_MS ?? 60 * 60 * 1000); // 1 hour default
  private readonly MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS ?? 20);
  // #endregion
  /**
   * Preload known collections at startup for performance.
   * Usage: await PageProofService.preloadCollections(['COLLECTION1', 'COLLECTION2']);
   */
  public static async preloadCollections(collectionNames: string[]): Promise<void> {
    const service = new PageProofService();
    await Promise.all(collectionNames.map(name => service.ensureCollectionExists(name)));
    // Optionally: log preloaded collections
    loggerService.logger.info('Preloaded collections', { collectionNames });
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }
  // #region Client Initialization
  private async getClient(): Promise<any> {
    const start = Date.now();
    if (!this.pageProofClientPromise) {
      this.pageProofClientPromise = PageProofAuthService.loginToPageProof().catch(err => {
        this.pageProofClientPromise = null;
        this.logError('Client initialization failed', err);
        throw ErrorHandler.createError(500, 'Failed to initialize PageProof client');
      });
    }
    const client = await this.pageProofClientPromise;
    loggerService.logger.info('getClient completed', { elapsedMs: Date.now() - start });
    return client;
  }
  // #endregion

  // #region Helper Methods
  private validate<T>(schema: z.ZodType<T>, data: any, label: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errorMsg = result.error.errors.map(e => e.message).join(', ');
      this.logError(`${label} validation failed`, errorMsg);
      throw ErrorHandler.createError(400, `${label} validation failed: ${errorMsg}`);
    }
    return result.data;
  }

  private logError(message: string, error: any, extra: Record<string, any> = {}) {
    loggerService.logger.error(`PageProofService: ${message}`, {
      error: error?.message ?? error,
      ...extra,
    });
  }
  // #endregion

  // #region Upload Files
  /**
   * Uploads files to PageProof, batching uploads for performance and memory efficiency.
   * Handles static files (optionally zipped) and non-static files separately.
   * @param files Array of FileUpload objects
   * @param isIndividual Whether to upload files individually
   * @returns Array of uploaded file info
   */
  public async uploadFiles(
    files: FileUpload[],
    isIndividual: boolean = false,
  ): Promise<{ fileId: string; fileNames: string[] }[]> {
    loggerService.logger.info('Uploading files', { count: files.length, isIndividual });

    const parsedFiles = this.validate(
      z.array(FileUploadSchema).min(1, 'At least one file is required'),
      files,
      'Files',
    );
    const client = await this.getClient();
    const results: { fileId: string; fileNames: string[] }[] = [];

    // Helper for batching uploads with concurrency
    const batchUpload = async (
      filesToUpload: (FileUpload | { fileName: string; fileBuffer: Buffer })[],
      uploadFn: (
        file: FileUpload | { fileName: string; fileBuffer: Buffer },
      ) => Promise<string | null>,
    ) => {
      for (let i = 0; i < filesToUpload.length; i += this.MAX_CONCURRENT_UPLOADS) {
        const batch = filesToUpload.slice(i, i + this.MAX_CONCURRENT_UPLOADS);
        const batchResults = await Promise.all(batch.map(uploadFn));
        batchResults.forEach((fileId, idx) => {
          if (fileId) results.push({ fileId, fileNames: [batch[idx].fileName] });
        });
      }
    };

    // Upload helper
    const uploadTasks = async (
      file: FileUpload | { fileName: string; fileBuffer: Buffer },
    ): Promise<string | null> => {
      const { fileName, fileBuffer } = file;
      if (!fileBuffer?.length) {
        this.logError('Empty file buffer', null, { fileName });
        return null;
      }
      try {
        const uploaded = await client.files.upload({
          name: fileName,
          contents: fileBuffer,
          async: true,
        });
        return uploaded?.id ?? null;
      } catch (error) {
        this.logError('File upload failed', error, { fileName });
        return null;
      }
    };

    // Separate static vs non-static files
    const staticFiles: FileUpload[] = [];
    const nonStaticFiles: FileUpload[] = [];
    for (const file of parsedFiles) {
      const fileType = file.fileName.split('.').pop()?.toLowerCase() || '';
      (Helper.isStaticFileType(fileType) ? staticFiles : nonStaticFiles).push(file);
    }

    // Upload static files (zip if multiple & !isIndividual)
    if (!isIndividual && staticFiles.length > 1) {
      const zipFileName = `proof-static-files-${Date.now()}.zip`;
      try {
        const zipBuffer = await Helper.createZipFile(staticFiles);
        const zipUploadResult = await uploadTasks({
          fileName: zipFileName,
          fileBuffer: zipBuffer,
        });
        if (zipUploadResult) {
          results.push({
            fileId: zipUploadResult,
            fileNames: staticFiles.map(file => file.fileName),
          });
        }
      } catch (error) {
        this.logError('Zip creation/upload failed, falling back', error);
        await batchUpload(staticFiles, uploadTasks);
      }
    } else {
      // Upload individually
      await batchUpload(staticFiles, uploadTasks);
    }

    // Upload non-static files (always individually)
    await batchUpload(nonStaticFiles, uploadTasks);

    loggerService.logger.info('File upload completed', { uploaded: results.length });
    return results;
  }
  // #endregion

  // #region Collection Handling
  /**
   * Ensures a collection exists in PageProof, using cache if available.
   * @param collectionName Name of the collection
   * @returns The collection object
   */
  public async ensureCollectionExists(collectionName: string): Promise<any> {
    const start = Date.now();
    const name = this.validate(CollectionNameSchema, collectionName, 'Collection name');

    // Check cache and TTL
    const cached = this.collectionCache.get(name);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      loggerService.logger.info('Using cached or inflight collection', { collectionName: name });
      loggerService.logger.info('ensureCollectionExists (cache hit)', {
        elapsedMs: Date.now() - start,
      });
      return cached.promise;
    }

    const fetchOrCreate = (async () => {
      const client = await this.getClient();
      try {
        const groupsStart = Date.now();
        const groups = await client.dashboard.groups.current(); // Use paginated fetch
        const groupsElapsed = Date.now() - groupsStart;
        if (groupsElapsed > 1000) {
          loggerService.logger.warn('Group fetch is slow', { elapsedMs: groupsElapsed });
        }
        loggerService.logger.info('Fetched groups', { elapsedMs: groupsElapsed });
        const existing = groups.find(
          (g: any) => this.normalizeName(g.name) === this.normalizeName(name),
        );
        if (existing) {
          loggerService.logger.info('Found existing collection', { collectionName: name });
          loggerService.logger.info('ensureCollectionExists (existing)', {
            elapsedMs: Date.now() - start,
          });
          return existing;
        }

        loggerService.logger.info('Creating new collection', { collectionName: name });
        const createStart = Date.now();
        const created = await client.proofs.groups.create({ name });
        loggerService.logger.info('Created new collection', {
          elapsedMs: Date.now() - createStart,
        });
        loggerService.logger.info('ensureCollectionExists (created)', {
          elapsedMs: Date.now() - start,
        });
        return created;
      } catch (error) {
        this.collectionCache.delete(name);
        this.logError('Collection fetch/create failed', error, { collectionName: name });
        throw ErrorHandler.createError(500, `Failed to fetch or create collection: ${name}`);
      }
    })();

    this.collectionCache.set(name, { promise: fetchOrCreate, timestamp: Date.now() });
    return fetchOrCreate;
  }

  // #endregion

  // #region Workflow Creation
  private async createWorkflow(
    workflow: ProofData['workflow'],
    documentType?: string,
  ): Promise<any> {
    const start = Date.now();

    try {
      const parsed = this.validate(WorkflowSchema, workflow, 'Workflow');
      const client = await this.getClient();

      const reviewers =
        Array.isArray(parsed.reviewers) && parsed.reviewers.length > 0
          ? parsed.reviewers.map(email => ({
              email,
              permissions: {
                inviter: true,
              },
              ...(documentType === 'drafts'
                ? {
                    role: 'mandatory',
                    permissions: {
                      inviter: true,
                    },
                  }
                : {}),
            }))
          : [];

      const approver =
        Array.isArray(parsed.approver) && parsed.approver.length > 0
          ? parsed.approver.map(email => ({ email }))
          : [];

      const workflowCreateStart = Date.now();
      const workflowInstance = await client.workflows.create({
        reviewers,
        approver,
      });
      loggerService.logger.info('Workflow created', {
        elapsedMs: Date.now() - workflowCreateStart,
      });

      // Only set the first step's due date if stepDueDate is present in the workflow metadata
      if (workflow && Object.prototype.hasOwnProperty.call(workflow, 'stepDueDate')) {
        const loadStart = Date.now();
        const loadedWorkflow = await client.workflows.load(workflowInstance.id);
        loggerService.logger.info('Workflow loaded', { elapsedMs: Date.now() - loadStart });
        if (
          loadedWorkflow &&
          Array.isArray(loadedWorkflow.steps) &&
          loadedWorkflow.steps.length > 0
        ) {
          const dueDate = new Date(
            Date.now() + Number(process.env.WORKFLOW_STEP_DUE_DATE_OFFSET) * 24 * 60 * 60 * 1000,
          ); // +5 days
          const firstStep = loadedWorkflow.steps[0];
          const stepUpdateStart = Date.now();
          await client.workflows.steps.update(firstStep.id, { dueDate });
          loggerService.logger.info('Workflow step due date set', {
            elapsedMs: Date.now() - stepUpdateStart,
          });
        }
      }
      loggerService.logger.info('createWorkflow completed', { elapsedMs: Date.now() - start });
      return workflowInstance;
    } catch (error) {
      this.logError('Workflow creation failed', error);
      throw ErrorHandler.createError(500, 'Workflow creation failed');
    }
  }
  // #endregion

  // #region Create Proofs
  /**
   * Creates proofs for the given proof data. Uses Promise.allSettled for robust error handling.
   * @param proofData ProofData object
   * @returns Array of created proofs and their file names
   */
  public async createProofs(proofData: ProofData): Promise<{ proof: any; fileNames: string[] }[]> {
    const totalStart = Date.now();
    loggerService.logger.info('Creating proof(s)', { proofName: proofData.proofName });

    const {
      proofName,
      collectionName,
      tags,
      messageToReviewers,
      dueDate,
      fileIds,
      workflow,
      owners,
    } = this.validate(ProofDataSchema, proofData, 'Proof data');

    const fetchStart = Date.now();
    const [client, collection, workflowInstance] = await Promise.all([
      this.getClient(),
      collectionName ? this.ensureCollectionExists(collectionName) : Promise.resolve(null),
      this.createWorkflow(workflow, proofData.documentType),
    ]);
    loggerService.logger.info('Fetched client, collection, workflow', {
      elapsedMs: Date.now() - fetchStart,
    });

    const createTasks = fileIds.map(async ({ fileId, fileNames }) => {
      const proofStart = Date.now();
      try {
        const proof = await client.proofs.create({
          name: proofName,
          tags,
          workflow: { id: workflowInstance.id },
          messageToReviewers,
          dueDate: new Date(dueDate),
          file: { id: fileId },
        });
        loggerService.logger.info('Proof created', { fileId, elapsedMs: Date.now() - proofStart });

        const groupOwnerStart = Date.now();
        await Promise.all([
          collection?.id ? client.proofs.groups.addProof(collection.id, proof.id) : null,
          owners?.length
            ? Promise.all(owners.map(email => client.proofs.owners.add(proof.id, { email })))
            : null,
        ]);
        loggerService.logger.info('Group/owner assignment done', {
          fileId,
          elapsedMs: Date.now() - groupOwnerStart,
        });

        return { proof, fileNames };
      } catch (err) {
        this.logError('Proof creation failed', err, { proofName, fileId });
        return null;
      }
    });

    const settleStart = Date.now();
    const settledResults = await Promise.allSettled(createTasks);
    loggerService.logger.info('All proof create tasks settled', {
      elapsedMs: Date.now() - settleStart,
    });
    const proofs = settledResults
      .filter(
        (r): r is PromiseFulfilledResult<{ proof: any; fileNames: string[] } | null> =>
          r.status === 'fulfilled',
      )
      .map(r => r.value)
      .filter((p): p is { proof: any; fileNames: string[] } => !!p);

    const approverStart = Date.now();
    try {
      if (workflow.approver.length > 1) {
        await client.workflows.setApprover(
          workflowInstance.id,
          workflow.approver.map(email => ({ email })),
        );
      } else if (workflow.approver.length === 1) {
        await client.workflows.setApprover(workflowInstance.id, { email: workflow.approver[0] });
      }
      loggerService.logger.info('Approver(s) set', { elapsedMs: Date.now() - approverStart });
    } catch (error) {
      this.logError('Failed to set approvers', error, { workflowId: workflowInstance.id });
      throw ErrorHandler.createError(500, 'Failed to set workflow approvers');
    }

    loggerService.logger.info('Proof creation completed', {
      proofCount: proofs.length,
      totalElapsedMs: Date.now() - totalStart,
    });
    return proofs;
  }
  // #endregion

  // #region Set Message to Reviewers
  /**
   * Sets the message to reviewers for a given proof.
   * @param proofId Proof ID
   * @param message Message to set
   * @returns The proof name or null
   */
  public async setMessageToReviewers(proofId: string, message: string): Promise<string | null> {
    const id = this.validate(ProofIdSchema, proofId, 'Proof ID');
    const client = await this.getClient();

    try {
      const response = await client.proofs.setMessageToReviewers(id, message);
      return response?.name ?? null;
    } catch (error) {
      this.logError('Failed to set message', error, { proofId: id });
      return null;
    }
  }
  // #endregion

  // #region Load Proof Details
  /**
   * Loads proof details for a given proof ID.
   * @param proofId Proof ID
   * @returns The proof details or null
   */
  public async loadProofDetails(proofId: string): Promise<any | null> {
    const id = this.validate(ProofIdSchema, proofId, 'Proof ID');
    const client = await this.getClient();

    try {
      return await client.proofs.load(id);
    } catch (error) {
      this.logError('Failed to load proof details', error, { proofId: id });
      return null;
    }
  }
  // #endregion

  // #region Lock Proof
  /**
   * Locks a proof in PageProof.
   * @param proofId Proof ID
   * @returns The lock result
   */
  public async lockProofService(proofId: string): Promise<any> {
    const id = this.validate(ProofIdSchema, proofId, 'Proof ID');
    const client = await this.getClient();

    try {
      const result = await client.proofs.lock(id);
      if (!result) throw ErrorHandler.createError(500, 'Failed to lock proof');
      return result;
    } catch (error) {
      this.logError('Failed to lock proof', error, { proofId: id });
      throw error instanceof Error ? error : ErrorHandler.createError(500, 'Failed to lock proof');
    }
  }
  // #endregion

  // #region Get Proofs in Group
  /**
   * Gets all proofs in a group by groupId
   * @param groupId Group ID
   * @returns Array of proofs in the group
   */
  public async getProofsInGroup(groupId: string): Promise<any[]> {
    const id = this.validate(ProofIdSchema, groupId, 'Group ID');
    const client = await this.getClient();
    try {
      const group = await client.proofs.groups.load(id);
      // The group object may have a 'proofs' property or similar
      if (group && Array.isArray(group.proofs)) {
        return group.proofs;
      }
      // If not, return empty array
      return [];
    } catch (error) {
      this.logError('Failed to fetch proofs in group', error, { groupId: id });
      return [];
    }
  }
  // #endregion

  // #region Group Details by ID
  /**
   * Gets group details (including name) by groupId
   * @param groupId Group ID
   * @returns The group object or null
   */
  public async getGroupById(groupId: string): Promise<any | null> {
    const id = this.validate(ProofIdSchema, groupId, 'Group ID');
    const client = await this.getClient();
    try {
      const group = await client.proofs.groups.load(id);
      return group || null;
    } catch (error) {
      this.logError('Failed to fetch group by id', error, { groupId: id });
      return null;
    }
  }
  // #endregion

  // #region Add Owners to proofs
  /**
   * Gets group details (including name) by groupId
   * @param proofId Proof ID
   * @param ownerEmail Owners Email

   * @returns The Added the owners or not as a boolean
   */
  public async addOwnersService(proofId: string, ownerEmail: string): Promise<any> {
    const id = this.validate(ProofIdSchema, proofId, 'Proof ID');
    const email = this.validate(OwnerEmailSchema, ownerEmail, 'Owner email');
    const client = await this.getClient();

    try {
      const result = await client.proofs.owners.add(id, { email });
      if (!result) {
        throw ErrorHandler.createError(500, 'Failed to add owner');
      }
      return result;
    } catch (error) {
      this.logError('Failed to add owner', error, { proofId: id, ownerEmail: email });
      throw error instanceof Error ? error : ErrorHandler.createError(500, 'Failed to add owner');
    }
  }

  public async removeOldOwners(proofId: string, keepOwnerEmail: string): Promise<boolean> {
    const id = this.validate(ProofIdSchema, proofId, 'Proof ID');
    const email = this.validate(OwnerEmailSchema, keepOwnerEmail, 'Owner email');
    const client = await this.getClient();
    const maxRetries = 3;
    const retryDelayMs = 1000; // Reduced from 3s to 1s for faster retries

    try {
      // Cache current user email to avoid repeated calls
      const whitelist = (await PageProofAuthService.getCurrentUser()).email.toLowerCase();
      const proofDetails = await this.loadProofDetails(id);

      if (!proofDetails || !proofDetails.owners) {
        throw ErrorHandler.createError(404, 'Proof not found or owners missing');
      }

      // Check for new owner presence once, no retries
      const newOwnerPresent = proofDetails.owners.some(
        (owner: { email: string }) => owner.email.toLowerCase() === email.toLowerCase(),
      );

      if (!newOwnerPresent) {
        loggerService.logger.warn('New owner not found, skipping removal', {
          proofId: id,
          ownerEmail: email,
        });
        return false;
      }

      // Filter owners to remove in one pass
      const ownersToRemove = proofDetails.owners
        .filter(
          (owner: { email: string }) =>
            owner.email.toLowerCase() !== email.toLowerCase() &&
            !whitelist.includes(owner.email.toLowerCase()),
        )
        .map((owner: { email: string }) => owner.email);

      if (ownersToRemove.length === 0) {
        loggerService.logger.info('No owners to remove', { proofId: id });
        return true;
      }

      // Batch remove owners in a single API call if supported
      try {
        await client.proofs.owners.batchRemove(id, ownersToRemove);
        loggerService.logger.info('Successfully removed owners', { proofId: id, ownersToRemove });
        return true;
      } catch (batchError) {
        // Fallback to individual removals with optimized retries
        await Promise.all(
          ownersToRemove.map(async (ownerEmail: string) => {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              try {
                await client.proofs.owners.remove(id, { email: ownerEmail });
                loggerService.logger.info('Successfully removed owner', {
                  proofId: id,
                  ownerEmail,
                });
                return;
              } catch (removeError) {
                if (
                  removeError instanceof Error &&
                  removeError.message.includes('400') &&
                  attempt < maxRetries - 1
                ) {
                  loggerService.logger.warn('Retrying owner removal due to 400 error', {
                    proofId: id,
                    ownerEmail,
                    attempt: attempt + 1,
                  });
                  await delay(retryDelayMs);
                  continue;
                }
                this.logError('Failed to remove owner', removeError, { proofId: id, ownerEmail });
              }
            }
          }),
        );
        return true;
      }
    } catch (error) {
      this.logError('Failed to remove old owners', error, { proofId: id, ownerEmail: email });
      return false;
    }
  }
  // #endregion

  // #region Update proof Version
  /**
   * Gets group details (including name) by groupId
   * @param proofId Proof ID
   * @param proofData Existing Proof data

   * @returns Updated proofs metadata and files
   */
  public async updateProofVersion(proofId: string, proofData: ExistingProofData): Promise<any[]> {
    const id = this.validate(ProofIdSchema, proofId, 'Proof ID');
    const data = this.validate(ExistingProofDataSchema, proofData, 'Existing proof data');

    const client = await this.getClient();

    try {
      const versions = await client.proofs.versions.list(id);
      if (versions.length === 0) {
        throw ErrorHandler.createError(404, 'No versions found for the provided proof ID');
      }

      const latestVersion = versions[versions.length - 1];
      const latestProof = await client.proofs.load(latestVersion.id);
      if (!latestProof?.id) {
        throw ErrorHandler.createError(500, 'Failed to load latest proof version');
      }

      const workflowInstance = await client.workflows.duplicate(
        latestProof.workflowId || data.workflowId,
      );

      const updateTasks = data.fileIds.map(async ({ fileId, fileNames }) => {
        try {
          const proof = await client.proofs.create({
            name: data.name || latestProof.name,
            groupId: data.groupId || latestProof.groupId,
            tags: data.tags || latestProof.tags,
            workflowTemplate: { id: workflowInstance.id },
            messageToReviewers: data.messageToReviewers || latestProof.messageToReviewers,
            dueDate: data.dueDate || latestProof.dueDate,
            file: { id: fileId },
            previousProof: { id: latestVersion.id },
          });
          if (!proof?.id) {
            throw ErrorHandler.createError(500, 'Proof creation returned invalid proof object');
          }
          return proof;
        } catch (error) {
          this.logError('Version update failed', error, { proofId: id, fileId });
          return null;
        }
      });

      const updatedProofs = (await Promise.all(updateTasks)).filter(Boolean);
      loggerService.logger.info('PageProofService: Proof version update completed', {
        proofId: id,
        updatedCount: updatedProofs.length,
      });
      return updatedProofs;
    } catch (error) {
      this.logError('Proof version update failed', error, { proofId: id });
      throw error instanceof Error
        ? error
        : ErrorHandler.createError(500, 'Proof version update failed');
    }
  }

  public async replaceReviewersAndApprovers(
    proofIds: string | string[],
    workflow: ProofData['workflow'],
  ): Promise<boolean> {
    const ids = Array.isArray(proofIds)
      ? this.validate(z.array(ProofIdSchema), proofIds, 'Proof IDs')
      : [this.validate(ProofIdSchema, proofIds, 'Proof ID')];
    const parsedWorkflow = this.validate(WorkflowSchema, workflow, 'Workflow');
    const client = await this.getClient();

    try {
      // Load all proof details in parallel
      const proofDetailsPromises = ids.map(async id => {
        const details = await this.loadProofDetails(id);
        if (!details?.workflowId) {
          throw ErrorHandler.createError(400, `Workflow ID not found for proof ${id}`);
        }
        return { id, details };
      });

      const proofDetails = await Promise.all(proofDetailsPromises);

      loggerService.logger.info('Replacing reviewers/approvers for proofs', {
        proofIds: ids,
        workflow: parsedWorkflow,
      });

      // Create a single workflow for all proofs
      const documentType = 'drafts';
      const workflowInstance = await this.createWorkflow(parsedWorkflow, documentType);

      loggerService.logger.info('New workflow created for proofs', {
        proofIds: ids,
        newWorkflowId: workflowInstance.id,
      });

      // Update all proofs with the new workflow in parallel
      const updateTasks = proofDetails.map(async ({ id }) => {
        try {
          await client.proofs.setWorkflow(id, workflowInstance.id);
          loggerService.logger.info('Reviewers and approvers replaced successfully', {
            proofId: id,
          });
          return true;
        } catch (error) {
          this.logError('Failed to set workflow for proof', error, { proofId: id });
          return false;
        }
      });

      const results = await Promise.all(updateTasks);
      const allSuccessful = results.every(result => result);

      if (!allSuccessful) {
        throw ErrorHandler.createError(
          500,
          'Failed to replace reviewers and approvers for some proofs',
        );
      }

      return true;
    } catch (error) {
      this.logError('Error replacing reviewers and approvers', error, {
        proofIds: ids,
        workflow: parsedWorkflow,
      });
      throw error instanceof Error
        ? error
        : ErrorHandler.createError(500, 'Failed to replace reviewers and approvers');
    }
  }

  public async updateProofDueDates(
    updates: { proofId: string; dueDate: string }[],
  ): Promise<{ proofId: string; success: boolean; message?: string; error?: string }[]> {
    loggerService.logger.info('PageProofService: updateProofDueDates started', {
      proofCount: updates.length,
    });

    const parsedUpdates = this.validate(DueDateUpdateSchema, updates, 'Due date updates');

    const client = await this.getClient();

    const results = await Promise.allSettled(
      parsedUpdates.map(async ({ proofId, dueDate }) => {
        try {
          const details = await this.loadProofDetails(proofId);
          if (!details) {
            return {
              proofId,
              success: false,
              error: 'Proof not found',
            };
          }

          await client.proofs.update([
            {
              id: proofId,
              dueDate: new Date(dueDate),
            },
          ]);

          return {
            proofId,
            success: true,
            message: `Due date updated to ${new Date(dueDate).toISOString()}`,
          };
        } catch (err) {
          this.logError('updateProofDueDates failed for proof', err, { proofId });
          return {
            proofId,
            success: false,
            error: (err as Error).message,
          };
        }
      }),
    );

    const formattedResults = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);

    loggerService.logger.info('PageProofService: updateProofDueDates completed', {
      proofCount: formattedResults.length,
    });

    return formattedResults;
  }

  // #region Archive Proofs
  /**
   * Archives proofs in PageProof using the dedicated archive method.
   * This action hides the proof from all users who have access to it, but can still be
   * found by manually searching for it (by name), or by calling Dashboard.archived.
   * @param proofIdOrIds Single proof ID or array of proof IDs
   * @returns Array of archive results
   */
  public async archiveProofs(
    proofIdOrIds: string | string[],
  ): Promise<{ proofId: string; success: boolean; message?: string; error?: string }[]> {
    const parsedProofIds = this.validate(ArchiveProofSchema, proofIdOrIds, 'Archive proof data');
    const proofIds = Array.isArray(parsedProofIds) ? parsedProofIds : [parsedProofIds];

    loggerService.logger.info('PageProofService: archiveProofs started', {
      proofCount: proofIds.length,
    });

    const client = await this.getClient();

    try {
      // Use the dedicated archive method from PageProof SDK
      await client.proofs.archive(proofIdOrIds);

      // Return success results for all proof IDs
      const results = proofIds.map(proofId => ({
        proofId,
        success: true,
        message: 'Proof archived successfully',
      }));

      loggerService.logger.info('PageProofService: archiveProofs completed', {
        proofCount: results.length,
      });

      return results;
    } catch (err) {
      this.logError('archiveProofs failed', err, { proofIds });

      // Return failure results for all proof IDs
      const results = proofIds.map(proofId => ({
        proofId,
        success: false,
        error: (err as Error).message,
      }));

      return results;
    }
  }
  // #endregion
}

export default new PageProofService();
