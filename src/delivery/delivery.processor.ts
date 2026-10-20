import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { DELIVERY_QUEUE, DeliveryJobData } from '../queue/queue.constants';
import { DeliveryOutcome, DeliveryService } from './delivery.service';

/** BullMQ worker: maps a DeliveryOutcome to "complete", "retry later" or "stop retrying". */
@Processor(DELIVERY_QUEUE, { concurrency: 5 })
export class DeliveryProcessor extends WorkerHost {
  constructor(private readonly delivery: DeliveryService) {
    super();
  }

  async process(job: Job<DeliveryJobData>): Promise<DeliveryOutcome> {
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

    const outcome = await this.delivery.deliver(job.data.notificationId, isLastAttempt);

    switch (outcome.kind) {
      case 'retry':
        // Throwing makes BullMQ schedule the next attempt with exponential backoff.
        throw new Error(outcome.error);
      case 'dead-lettered':
        // Already parked in the dead-letter queue; tell BullMQ not to retry.
        throw new UnrecoverableError(outcome.error);
      default:
        return outcome;
    }
  }
}
