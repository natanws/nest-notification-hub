import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryQueueService } from './delivery-queue.service';
import { DEAD_LETTER_QUEUE, DELIVERY_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get('REDIS_URL', 'redis://localhost:6379'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: DELIVERY_QUEUE }, { name: DEAD_LETTER_QUEUE }),
  ],
  providers: [DeliveryQueueService],
  exports: [DeliveryQueueService, BullModule],
})
export class QueueModule {}
