import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { MeController } from './auth/me.controller';
import { DocumentsModule } from './documents/documents.module';
import { RagModule } from './rag/rag.module';
import { MetricsModule } from './metrics/metrics.module';
import { VoiceModule } from './voice/voice.module';
import { SchemasController } from './schemas/schemas.controller';
import { RfiController } from './rfi/rfi.controller';
import { InMemoryRfiRepository } from './rfi/rfi.repository';

@Module({
  // VoiceModule is isolated - uses WebSocket on /voice namespace
  // RagModule handles HTTP /chat/stream - unchanged
  // DocumentsModule handles uploads/viewing - unchanged
  imports: [AuthModule, DocumentsModule, RagModule, MetricsModule, VoiceModule],
  controllers: [AppController, MeController, SchemasController, RfiController],
  providers: [InMemoryRfiRepository],
})
export class AppModule {}
