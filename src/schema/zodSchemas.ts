import { z } from 'zod';
export const ProofWebhookSchema = z.object({
  proof: z.object({
    id: z.string().min(1),
    status: z.string(),
    name: z.string().optional(),
    dueDate: z.string().optional(),
    approvedDate: z.string().optional().or(z.null()),
  }),
  trigger: z
    .object({
      email: z.string().email().optional(),
    })
    .optional(),
});

export const OverdueWebhookSchema = z.object({
  proof: z.object({
    id: z.string().min(1),
    status: z.string(),
    name: z.string().optional(),
    dueDate: z.string().optional(),
  }),
});
// Metadata Schema for ProofController.createProof
export const MetadataSchema = z.object({
  proofName: z.string().optional().or(z.literal('')),
  collectionName: z.string().min(1, 'Collection name is required'),
  tags: z.array(z.string()).default([]),
  messageToReviewers: z.string().default(''),
  documentType: z.enum(['markups', 'drafts', 'translated']).optional().default('markups'),
  dueDate: z
    .string()
    .refine(date => !isNaN(Date.parse(date)), { message: 'Invalid date' })
    .optional(),
  workflow: z.object({
    name: z.string().min(1, 'Workflow name is required'),
    reviewers: z.array(z.string().email('Invalid reviewer email')).optional(),
    approver: z.array(z.string().email('Invalid approver email')).optional(),
    stepDueDate: z
      .string()
      .refine(date => !isNaN(Date.parse(date)), { message: 'Invalid date' })
      .optional(),
  }),
  owners: z.array(z.string().email('Invalid owner email')),
});

// Workflow Schema for createWorkflow
export const WorkflowSchema = z.object({
  name: z.string().min(1, 'Workflow name is required').optional(),
  reviewers: z.array(z.string().email('Invalid reviewer email')).optional(),
  approver: z.array(z.string().email('Invalid approver email')).optional(),
});

// ProofData Schema for PageProofService.createProofs
export const ProofDataSchema = z.object({
  proofName: z.string().min(1, 'Proof name is required'),
  collectionName: z.string().min(1, 'Collection name is required'),
  tags: z.array(z.string()).default([]),
  messageToReviewers: z.string().default(''),
  dueDate: z.string().refine(date => !isNaN(Date.parse(date)), { message: 'Invalid date' }),
  fileIds: z.array(z.object({ fileId: z.string(), fileNames: z.array(z.string()) })).min(1),
  documentType: z.enum(['markups', 'drafts', 'translated']).optional().default('markups'),
  workflow: WorkflowSchema,
  owners: z.array(z.string().email()).optional(),
});

// File Schema for file uploads
export const FileSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  fileBase64: z.string().min(1, 'File content is required'),
});

// Files Array Schema for createProof and updateProof
export const FilesSchema = z.array(FileSchema).min(1, 'At least one file is required');

// ProofIds Schema for lockProof and addOwners
export const ProofIdsSchema = z
  .array(z.string().min(1, 'Proof ID is required'))
  .min(1, 'At least one proof ID is required');

// ProofId Schema for loadDecisions, lockProofService, loadProofDetails, getGroupNameById
export const ProofIdSchema = z.string().min(1, 'Proof ID is required');

// OwnerEmail Schema for addOwners
export const OwnerEmailSchema = z.string().email('Invalid owner email');

// ExistingProofData Schema for updateProofVersion
export const ExistingProofDataSchema = z.object({
  name: z.string().min(1, 'Proof name is required'),
  groupId: z.string().min(1, 'Group ID is required'),
  tags: z.array(z.string()).default([]),
  messageToReviewers: z.string().default(''),
  dueDate: z.string().refine(date => !isNaN(Date.parse(date)), { message: 'Invalid date' }),
  fileIds: z.array(z.object({ fileId: z.string(), fileNames: z.array(z.string()) })).min(1),
  workflowId: z.string().min(1, 'Workflow ID is required'),
  ownerEmail: z.string().email('Invalid owner email').optional(),
});

export const DueDateUpdateSchema = z.array(
  z.object({
    proofId: z.string(),
    dueDate: z.string(),
  }),
);
// CollectionName Schema for ensureCollectionExists
export const CollectionNameSchema = z.string().min(1, 'Collection name is required');

// FileUpload Schema for uploadFiles
export const FileUploadSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  fileBuffer: z.instanceof(Buffer, { message: 'File buffer must be a Buffer instance' }),
});

export const ReplaceApproverSchema = z.object({
  proofId: z.string().min(1),
  newApproverEmail: z.string().email(),
});

// Archive Proof Schema for archiveProof
export const ArchiveProofSchema = z.union([
  z.string().min(1, 'Proof ID is required'),
  z.array(z.string().min(1, 'Proof ID is required')).min(1, 'At least one proof ID is required'),
]);

// TypeScript Types
export type Metadata = z.infer<typeof MetadataSchema>;
export type ProofData = z.infer<typeof ProofDataSchema>;
export type FileUpload = z.infer<typeof FileUploadSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type ExistingProofData = z.infer<typeof ExistingProofDataSchema>;
export type ReplaceApproverSchema = z.infer<typeof ReplaceApproverSchema>;
export type ProofWebhookSchema = z.infer<typeof ProofWebhookSchema>;
export type OverdueWebhookSchema = z.infer<typeof OverdueWebhookSchema>;
export type DueDateUpdateSchema = z.infer<typeof DueDateUpdateSchema>;
export type ArchiveProofSchema = z.infer<typeof ArchiveProofSchema>;
