import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import Busboy from 'busboy';
import { Request, Response, NextFunction } from 'express';

import { loggerService } from '../utils/logger';
import config from '../config';

const unlinkAsync = promisify(fs.unlink);
const statAsync = promisify(fs.stat);
const accessAsync = promisify(fs.access);

export interface FileInfo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  path: string;
  buffer?: Buffer;
}
const TEMP_DIR = config.app.temp || '/tmp'; // Use environment variable or default to /tmp

// Validate TEMP_DIR at startup
const validateTempDir = async () => {
  try {
    await accessAsync(TEMP_DIR, fs.constants.W_OK);
    const stats = await statAsync(TEMP_DIR);
    if (!stats.isDirectory()) {
      throw new Error(`${TEMP_DIR} is not a directory`);
    }
    loggerService.logger.info(`Temporary directory validated: ${TEMP_DIR}`);
  } catch (err) {
    loggerService.logger.error('Invalid temporary directory', {
      tempDir: TEMP_DIR,
      error: (err as any).message,
    });
    throw new Error(`Temporary directory ${TEMP_DIR} is not accessible`);
  }
};

// Run validation at module load
validateTempDir().catch(err => {
  loggerService.logger.error('Failed to validate temp directory:', err);
  process.exit(1); // Exit if TEMP_DIR is invalid
});

const MEMORY_THRESHOLD = 200 * 1024 * 1024; // 200MB

export const busboyUpload = (options: {
  limits?: {
    fileSize?: number;
    files?: number;
  };
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const files: FileInfo[] = [];
    const body: any = {};
    let fileCount = 0;
    const maxFiles = Number(process.env.MAXFILE_UPLOAD) || 10;
    const maxFileSize = options.limits?.fileSize || 200 * 1024 * 1024;

    let requestAborted = false;
    let busboyError: Error | null = null;

    // Log incoming request details for debugging
    loggerService.logger.info('Busboy upload started', {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      maxFiles,
      maxFileSize: maxFileSize / 1024 / 1024 + 'MB',
    });

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: maxFileSize,
        files: maxFiles,
      },
    });

    busboy.on('file', (fieldname, file, info) => {
      if (requestAborted) {
        loggerService.logger.warn('File event received but request was aborted', { fieldname });
        return;
      }

      const { filename, encoding, mimeType } = info;

      loggerService.logger.info('File event received', {
        fieldname,
        filename,
        encoding,
        mimeType,
        fileCount: fileCount + 1,
        maxFiles,
      });

      if (fileCount >= maxFiles) {
        requestAborted = true;
        file.resume();
        loggerService.logger.error('Max file count exceeded', { fileCount, maxFiles });
        return res.status(400).json({ error: `Maximum file count (${maxFiles}) exceeded` });
      }

      let fileSize = 0;
      const chunks: Buffer[] = [];
      let tempPath: string | null = null;
      let writeStream: fs.WriteStream | null = null;
      let useMemoryOnly = true;
      let fileProcessed = false;

      file.on('data', chunk => {
        if (requestAborted) return;

        fileSize += chunk.length;
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

        if (fileSize > maxFileSize) {
          requestAborted = true;
          file.resume();
          loggerService.logger.error('File size exceeded', {
            filename,
            fileSize,
            maxFileSize,
          });
          if (writeStream) writeStream.destroy();
          if (tempPath) fs.unlink(tempPath, () => {});
          return res
            .status(400)
            .json({ error: `File ${filename} exceeds ${maxFileSize / 1024 / 1024}MB limit` });
        }

        if (fileSize > MEMORY_THRESHOLD) {
          useMemoryOnly = false;
          if (!tempPath) {
            tempPath = path.join(TEMP_DIR, `${Date.now()}-${filename}`);
            writeStream = fs.createWriteStream(tempPath);
            chunks.forEach(c => writeStream!.write(c));
            chunks.length = 0;
            loggerService.logger.info('Switched to disk storage', { filename, tempPath });
          }
          writeStream!.write(bufferChunk);
        } else {
          chunks.push(bufferChunk);
        }
      });

      file.on('end', async () => {
        if (requestAborted) {
          loggerService.logger.warn('File end event but request was aborted', { filename });
          return;
        }

        loggerService.logger.info('File end event', {
          filename,
          fileSize,
          useMemoryOnly,
          tempPath,
        });

        try {
          if (useMemoryOnly) {
            const finalBuffer = Buffer.concat(chunks);
            files.push({
              fieldname,
              originalname: filename,
              encoding,
              mimetype: mimeType,
              size: fileSize,
              path: '',
              buffer: finalBuffer,
            });
            loggerService.logger.info('File stored in memory', { filename, size: fileSize });
          } else if (writeStream && tempPath) {
            writeStream.end(async () => {
              try {
                const finalBuffer = await fs.promises.readFile(tempPath);
                files.push({
                  fieldname,
                  originalname: filename,
                  encoding,
                  mimetype: mimeType,
                  size: fileSize,
                  path: tempPath,
                  buffer: finalBuffer,
                });
                loggerService.logger.info('File stored on disk', {
                  filename,
                  tempPath,
                  size: fileSize,
                });
              } catch (err) {
                requestAborted = true;
                loggerService.logger.error('Failed to read file from disk', {
                  tempPath,
                  error: (err as any).message,
                });
                await unlinkAsync(tempPath);
                return res.status(500).json({ error: `Failed to process file ${filename}` });
              }
            });
          }

          fileProcessed = true;
          fileCount++;
          loggerService.logger.info('File processing completed', { filename, fileCount });
        } catch (err) {
          loggerService.logger.error('Error processing file end', {
            filename,
            error: (err as any).message,
          });
          if (writeStream) writeStream.destroy();
          if (tempPath) fs.unlink(tempPath, () => {});
          requestAborted = true;
          next(err);
        }
      });

      file.on('error', err => {
        if (requestAborted) return;
        requestAborted = true;
        loggerService.logger.error('Busboy file error', { filename, error: err.message });
        if (writeStream) writeStream.destroy();
        if (tempPath) fs.unlink(tempPath, () => {});
        busboyError = err;
        next(err);
      });

      file.on('limit', () => {
        if (requestAborted) return;
        requestAborted = true;
        loggerService.logger.error('File size limit hit', { filename, fileSize });
        if (writeStream) writeStream.destroy();
        if (tempPath) fs.unlink(tempPath, () => {});
        return res
          .status(400)
          .json({ error: `File ${filename} exceeds ${maxFileSize / 1024 / 1024}MB limit` });
      });
    });

    busboy.on('field', (name, value) => {
      if (requestAborted) return;
      body[name] = value;
      loggerService.logger.debug('Field received', { name, valueLength: value?.length });
    });

    busboy.on('finish', () => {
      if (requestAborted) {
        loggerService.logger.warn('Busboy finish event but request was aborted');
        return;
      }

      loggerService.logger.info('All files processed', {
        fileCount,
        bodyKeys: Object.keys(body),
        files: files.map(f => ({
          name: f.originalname,
          size: f.size,
          source: f.path ? 'disk' : 'memory',
          fieldname: f.fieldname,
        })),
      });

      if (files.length === 0) {
        loggerService.logger.warn('No files were processed', {
          contentType: req.headers['content-type'],
          contentLength: req.headers['content-length'],
        });
      }

      (req as any).files = files;
      req.body = body;
      next();
    });

    busboy.on('error', err => {
      if (requestAborted) return;
      requestAborted = true;
      loggerService.logger.error('Busboy general error', {
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      files.forEach(f => {
        if (f.path) fs.unlink(f.path, () => {});
      });
      busboyError = err as Error;
      next(err);
    });

    // Handle request errors
    req.on('error', err => {
      if (requestAborted) return;
      requestAborted = true;
      loggerService.logger.error('Request error during file upload', { error: err.message });
      files.forEach(f => {
        if (f.path) fs.unlink(f.path, () => {});
      });
      next(err);
    });

    req.on('aborted', () => {
      if (requestAborted) return;
      requestAborted = true;
      loggerService.logger.warn('Request aborted during file upload');
      files.forEach(f => {
        if (f.path) fs.unlink(f.path, () => {});
      });
    });

    req.pipe(busboy);
  };
};
