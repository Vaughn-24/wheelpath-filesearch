import { Module } from '@nestjs/common';

import { PilotController } from './pilot.controller';
import { PilotService } from './pilot.service';

@Module({
  controllers: [PilotController],
  providers: [PilotService],
  exports: [PilotService],
})
export class PilotModule {}
