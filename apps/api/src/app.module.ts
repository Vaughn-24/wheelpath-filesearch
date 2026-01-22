import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { MeController } from './auth/me.controller';
import { CommonModule } from './common/common.module';
import { DocumentsModule } from './documents/documents.module';
import { RagModule } from './rag/rag.module';
import { MetricsModule } from './metrics/metrics.module';
import { VoiceModule } from './voice/voice.module';
import { TenantModule } from './tenant/tenant.module';
import { PilotModule } from './pilot/pilot.module';
import { SchemasController } from './schemas/schemas.controller';
import { RfiController } from './rfi/rfi.controller';
import { InMemoryRfiRepository } from './rfi/rfi.repository';

@Module({
  // TenantModule provides File Search Store management (global)
  // CommonModule provides shared rate limiting across all features
  // VoiceModule is isolated - uses WebSocket on /voice namespace
  // RagModule handles HTTP /chat/stream
  // DocumentsModule handles uploads/viewing
  // PilotModule handles pilot program signups (public endpoint)
  imports: [TenantModule, CommonModule, AuthModule, DocumentsModule, RagModule, MetricsModule, VoiceModule, PilotModule],
  controllers: [AppController, MeController, SchemasController, RfiController],
  providers: [InMemoryRfiRepository],
})
export class AppModule {}
