import { Module } from '@nestjs/common';
import { VoiceGateway } from './voice.gateway';
import { VoiceService } from './voice.service';
import { VoiceLiveService } from './voice-live.service';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [MetricsModule],
  providers: [VoiceGateway, VoiceService, VoiceLiveService],
})
export class VoiceModule {}

