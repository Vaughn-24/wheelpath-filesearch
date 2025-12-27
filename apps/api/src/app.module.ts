import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { MeController } from './auth/me.controller';
import { CommonModule } from './common/common.module';
import { DocumentsModule } from './documents/documents.module';
import { RagModule } from './rag/rag.module';
import { MetricsModule } from './metrics/metrics.module';
import { VoiceModule } from './voice/voice.module';
import { SchemasController } from './schemas/schemas.controller';
import { RfiController } from './rfi/rfi.controller';
import { InMemoryRfiRepository } from './rfi/rfi.repository';
import { FirebaseAdminService } from './firebase/firebase-admin.service';

@Module({
  // CommonModule provides shared rate limiting across all features
  // VoiceModule is isolated - uses WebSocket on /voice namespace
  // RagModule handles HTTP /chat/stream
  // DocumentsModule handles uploads/viewing
  imports: [CommonModule, AuthModule, DocumentsModule, RagModule, MetricsModule, VoiceModule],
  controllers: [AppController, MeController, SchemasController, RfiController],
  providers: [InMemoryRfiRepository, FirebaseAdminService],
  exports: [FirebaseAdminService],
})
export class AppModule {}
