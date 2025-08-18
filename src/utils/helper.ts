import path from 'path';
import { promises as fs } from 'fs';

import yazl from 'yazl';

import { FileUpload } from '../schema/zodSchemas';

import { loggerService } from './logger';

class Helper {
  // #region File Type Detection

  public static getFileType(fileName: string): 'video' | 'static' | 'other' {
    const ext = path.extname(fileName).toLowerCase();
    if (['.mp4', '.avi', '.mov', '.m4v', '.gif', '.mkv'].includes(ext)) return 'video';
    if (['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.txt'].includes(ext)) return 'static';
    return 'other';
  }

  public static getFileExtension(fileName: string): string {
    return fileName.split('.').pop()?.toLowerCase() || '';
  }

  public static isStaticFileType(fileType: string): boolean {
    const staticFileTypes = [
      'pdf',
      'png',
      'jpg',
      'jpeg',
      'jfif',
      'tiff',
      'svg',
      'webp',
      'bmp',
      'doc',
      'docx',
      'txt',
      'rtf',
      'csv',
      'xlsx',
      'ppt',
      'pptx',
      'key',
      'pages',
      'numbers',
      'incx',
      'psd',
      'ai',
      'heic',
      'otf',
      'ttf',
      'ttc',
      'eml',
    ];
    return staticFileTypes.includes(fileType.toLowerCase());
  }

  // #endregion

  // #region URL Generation

  public static generateProofUrl(proofId: string, fileName: string): string {
    if (!proofId) throw new Error('Proof ID is required for generating proof URL');

    const fileType = this.getFileType(fileName);
    let typeSegment: string;

    switch (fileType) {
      case 'video':
        typeSegment = 'video';
        break;
      case 'static':
        typeSegment = 'static';
        break;
      default:
        typeSegment = 'static';
        break;
    }

    return `https://app.pageproof.com/proof/${typeSegment}/${proofId}`;
  }

  // #endregion

  // #region Validation & Utilities

  public static validateRequestBody(
    body: Record<string, any>,
    requiredFields: string[],
  ): string | null {
    for (const field of requiredFields) {
      const value = body[field];
      if (!value || (Array.isArray(value) && value.length === 0)) {
        return `Missing required field: ${field}`;
      }
    }
    return null;
  }

  public static shouldLockProof(status: string, dueDateStr?: string): boolean {
    const isApproved = status?.toLowerCase() === 'approved';
    const isOverdue = dueDateStr ? new Date(dueDateStr) < new Date() : false;
    return isApproved || isOverdue;
  }

  public static groupFilesByType(files: FileUpload[]): Record<string, FileUpload[]> {
    const grouped: Record<string, FileUpload[]> = {};
    for (const file of files) {
      const ext = this.getFileExtension(file.fileName);
      if (!grouped[ext]) grouped[ext] = [];
      grouped[ext].push(file);
    }
    return grouped;
  }

  // #endregion

  // #region Compression

  public static async createZipFile(files: FileUpload[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const zipfile = new yazl.ZipFile();
        for (const file of files) {
          if (!file.fileBuffer || !file.fileName) {
            loggerService.logger.error(`Zip error: Invalid file: ${file.fileName || 'unknown'}`);
            return reject(new Error(`Invalid file: ${file.fileName || 'unknown'}`));
          }
          if (!Buffer.isBuffer(file.fileBuffer)) {
            loggerService.logger.error(
              `Zip error: fileBuffer is not a Buffer for file: ${file.fileName}`,
            );
            return reject(new Error(`fileBuffer is not a Buffer for file: ${file.fileName}`));
          }
          if (file.fileBuffer.length === 0) {
            loggerService.logger.error(`Zip error: fileBuffer is empty for file: ${file.fileName}`);
            return reject(new Error(`fileBuffer is empty for file: ${file.fileName}`));
          }
          // Log file name, buffer size, and first 16 bytes as hex for debugging
          const firstBytes = file.fileBuffer.slice(0, 16).toString('hex');
          loggerService.logger.debug(
            `Adding to zip: ${file.fileName}, size: ${file.fileBuffer.length}, first 16 bytes: ${firstBytes}`,
          );
          zipfile.addBuffer(file.fileBuffer, file.fileName);
        }
        const chunks: Buffer[] = [];
        zipfile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        zipfile.outputStream.on('end', async () => {
          const zipBuffer = Buffer.concat(chunks);
          loggerService.logger.debug('Zip creation complete, total size:', zipBuffer.length);
          // Save zip to disk for debugging (only in non-production)
          if (process.env.NODE_ENV !== 'production') {
            try {
              await fs.writeFile('/tmp/debug-proof.zip', zipBuffer);
              loggerService.logger.debug('Debug zip written to /tmp/debug-proof.zip');
            } catch (err) {
              loggerService.logger.error('Failed to write debug zip:', err);
            }
          }
          resolve(zipBuffer);
        });
        zipfile.outputStream.on('error', (err: Error) => {
          loggerService.logger.error('Zip outputStream error:', err);
          reject(new Error(`Failed to create ZIP file: ${err.message}`));
        });
        zipfile.end();
      } catch (error) {
        loggerService.logger.error('Zip creation failed:', error);
        reject(new Error(`Failed to create ZIP file: ${(error as Error).message}`));
      }
    });
  }

  // #endregion
}

export { Helper };
