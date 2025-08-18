import { Response } from 'express';

import { loggerService } from './logger';

interface ErrorDetails {
  message: string;
  code?: string;
  statusCode: number;
  timestamp: string;
  requestId?: string;
}

class ErrorHandler {
  // Method to create a structured error
  public static createError(statusCode: number, message: string, code?: string): Error {
    const error = new Error(message) as any;
    error.statusCode = statusCode;
    error.code = code;
    error.timestamp = new Date().toISOString();

    loggerService.logger.error(`Error created: ${message}`, {
      statusCode,
      code,
      timestamp: error.timestamp,
    });

    return error;
  }

  // Method to handle errors and send appropriate response
  public static handleError(
    res: Response,
    statusCode: number,
    message: string,
    error?: Error,
    requestId?: string,
  ): void {
    const errorDetails: ErrorDetails = {
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      requestId,
    };

    // Add error code if available
    if (error && (error as any).code) {
      errorDetails.code = (error as any).code;
    }

    // Log the error with appropriate level
    if (error) {
      loggerService.logger.error(`${message}: ${error.message}`, {
        stack: error.stack,
        statusCode,
        code: errorDetails.code,
        requestId,
      });
    } else {
      loggerService.logger.warn(message, {
        statusCode,
        code: errorDetails.code,
        requestId,
      });
    }

    // Sanitize error response for production
    const response = {
      error: message,
      ...(process.env.NODE_ENV === 'development' && {
        details: error ? error.message : undefined,
        stack: error ? error.stack : undefined,
      }),
      ...(requestId && { requestId }),
    };

    // Send error response
    res.status(statusCode).json(response);
  }

  // Method to handle validation errors
  public static handleValidationError(res: Response, errors: any[], requestId?: string): void {
    const message = 'Validation failed';
    const statusCode = 400;

    loggerService.logger.warn('Validation error', {
      errors: errors.map(e => ({ field: e.path, message: e.message })),
      requestId,
    });

    const response = {
      error: message,
      details: errors.map(e => ({
        field: e.path?.join('.') || 'unknown',
        message: e.message,
      })),
      ...(requestId && { requestId }),
    };

    res.status(statusCode).json(response);
  }

  // Method to handle authentication errors
  public static handleAuthError(
    res: Response,
    message: string = 'Authentication failed',
    requestId?: string,
  ): void {
    const statusCode = 401;

    loggerService.logSecurityEvent('Authentication error', {
      message,
      requestId,
    });

    const response = {
      error: message,
      ...(requestId && { requestId }),
    };

    res.status(statusCode).json(response);
  }

  // Method to handle authorization errors
  public static handleAuthorizationError(
    res: Response,
    message: string = 'Access denied',
    requestId?: string,
  ): void {
    const statusCode = 403;

    loggerService.logSecurityEvent('Authorization error', {
      message,
      requestId,
    });

    const response = {
      error: message,
      ...(requestId && { requestId }),
    };

    res.status(statusCode).json(response);
  }

  // Method to handle rate limiting errors
  public static handleRateLimitError(
    res: Response,
    message: string = 'Too many requests',
    retryAfter?: number,
    requestId?: string,
  ): void {
    const statusCode = 429;

    loggerService.logger.warn('Rate limit exceeded', {
      message,
      retryAfter,
      requestId,
    });

    const response: any = {
      error: message,
      ...(requestId && { requestId }),
    };

    if (retryAfter) {
      response.retryAfter = retryAfter;
      res.setHeader('Retry-After', retryAfter.toString());
    }

    res.status(statusCode).json(response);
  }

  // Method to handle internal server errors
  public static handleInternalError(res: Response, error: Error, requestId?: string): void {
    const statusCode = 500;
    const message = 'Internal server error';

    loggerService.logger.error('Internal server error', {
      error: error.message,
      stack: error.stack,
      requestId,
    });

    const response = {
      error: message,
      ...(process.env.NODE_ENV === 'development' && {
        details: error.message,
        stack: error.stack,
      }),
      ...(requestId && { requestId }),
    };

    res.status(statusCode).json(response);
  }

  // Method to sanitize error messages for production
  public static sanitizeErrorMessage(message: string): string {
    // Remove potentially sensitive information from error messages
    const sensitivePatterns = [
      /password\s*[:=]\s*\S+/gi,
      /token\s*[:=]\s*\S+/gi,
      /secret\s*[:=]\s*\S+/gi,
      /key\s*[:=]\s*\S+/gi,
      /authorization\s*[:=]\s*\S+/gi,
    ];

    let sanitized = message;
    sensitivePatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });

    return sanitized;
  }

  // Method to generate request ID for tracking
  public static generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export { ErrorHandler };
