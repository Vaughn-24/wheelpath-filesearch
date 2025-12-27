import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

/**
 * Logging Interceptor - Logs all HTTP requests and responses
 * 
 * Logs:
 * - Request method, URL, headers (sanitized)
 * - Authentication status
 * - Response status codes
 * - Request duration
 * - Errors
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, url, headers, body } = request;
    const startTime = Date.now();

    // Extract auth token (sanitized for logging)
    const authHeader = headers.authorization || '';
    const hasToken = !!authHeader;
    const tokenPrefix = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7, 27) + '...'
      : 'none';

    // [Checkpoint 6] Request received
    this.logger.log(`[${method}] ${url}`, {
      hasAuth: hasToken,
      tokenPrefix,
      contentType: headers['content-type'] || 'none',
      userAgent: headers['user-agent']?.substring(0, 50) || 'none',
      bodySize: JSON.stringify(body || {}).length,
    });

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        // [Checkpoint 10] Response sent
        this.logger.log(`[${method}] ${url} ${response.statusCode} (${duration}ms)`, {
          statusCode: response.statusCode,
          duration,
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error(`[${method}] ${url} ERROR (${duration}ms)`, {
          statusCode: error?.status || 500,
          error: error?.message || 'Unknown error',
          stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
          duration,
        });
        throw error;
      }),
    );
  }
}

