import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  DEAD_LETTER_QUEUE,
  DeadLetterJobData,
  DELIVER_JOB,
  DELIVERY_QUEUE,
  DeliveryJobData,
} from './queue.constants';

/** Producer side of the queues. Retries and backoff are configured per job here. */
@Injectable()
export class DeliveryQueueService {
  constructor(
    @InjectQueue(DELIVERY_QUEUE) private readonly deliveryQueue: Queue<DeliveryJobData>,
    @InjectQueue(DEAD_LETTER_QUEUE) private readonly deadLetterQueue: Queue<DeadLetterJobData>,
    private readonly config: ConfigService,
  ) {}

  get maxAttempts(): number {
    return Number(this.config.get('DELIVERY_MAX_ATTEMPTS', 5));
  }

  /**
   * Queues a delivery. The job id defaults to the notification id, so enqueueing the same
   * notification twice (e.g. API + sweeper) does not create two jobs.
   */
  async enqueue(notificationId: string, jobId: string = notificationId): Promise<void> {
    await this.deliveryQueue.add(
      DELIVER_JOB,
      { notificationId },
      {
        jobId,
        attempts: this.maxAttempts,
        backoff: {
          type: 'exponential',
          delay: Number(this.config.get('DELIVERY_BACKOFF_MS', 1000)),
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  async deadLetter(data: DeadLetterJobData): Promise<void> {
    await this.deadLetterQueue.add('dead-letter', data, { removeOnComplete: false });
  }
}
