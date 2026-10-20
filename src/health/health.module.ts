import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { QueueModule } from '../queue/queue.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, QueueModule],
  controllers: [HealthController],
})
export class HealthModule {}
