import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { DeliveryQueueService } from '../queue/delivery-queue.service';

/**
 * Safety net for the gap between "row saved" and "job queued": if the process dies (or Redis is
 * down) right after the INSERT, the notification would stay PENDING forever. This sweeper
 * re-enqueues old PENDING rows; the job id is the notification id, so it never duplicates a job
 * that is still in the queue.
 *
 * A transactional outbox would close the gap completely; this is the simpler trade-off.
 */
@Injectable()
export class PendingSweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PendingSweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly queue: DeliveryQueueService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(this.config.get('SWEEP_INTERVAL_MS', 30_000));
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(
    staleAfterMs = Number(this.config.get('SWEEP_STALE_AFTER_MS', 60_000)),
  ): Promise<number> {
    try {
      const stale = await this.repository.findStalePending(new Date(Date.now() - staleAfterMs));
      for (const notification of stale) {
        await this.queue.enqueue(notification.id);
      }
      if (stale.length > 0) this.logger.warn(`Re-enqueued ${stale.length} stale notification(s)`);
      return stale.length;
    } catch (error) {
      this.logger.error(`Sweep failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
