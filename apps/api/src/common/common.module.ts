import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import { LoggingInterceptor } from './logging.interceptor';

@Global()
@Module({
  providers: [
    RateLimitService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
  exports: [RateLimitService],
})
export class CommonModule {}

