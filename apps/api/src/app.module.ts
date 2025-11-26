import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { MeController } from './auth/me.controller';
import { DocumentsModule } from './documents/documents.module';
import { RagModule } from './rag/rag.module';
import { SchemasController } from './schemas/schemas.controller';
import { RfiController } from './rfi/rfi.controller';
import { InMemoryRfiRepository } from './rfi/rfi.repository';

@Module({
  imports: [AuthModule, DocumentsModule, RagModule],
  controllers: [AppController, MeController, SchemasController, RfiController],
  providers: [InMemoryRfiRepository],
})
export class AppModule {}
