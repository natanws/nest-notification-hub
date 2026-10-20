import { Inject, Injectable, Logger } from '@nestjs/common';
import { Channel, NotificationStatus } from '@prisma/client';
import { MetricsService } from '../metrics/metrics.service';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { DeliveryQueueService } from '../queue/delivery-queue.service';
import { CHANNEL_PROVIDERS, ChannelProvider, PermanentDeliveryError } from './channels/channel';

export type DeliveryOutcome =
  | { kind: 'delivered' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'retry'; error: string }
  | { kind: 'dead-lettered'; error: string; permanent: boolean };

/**
 * Delivers one notification once. Kept free of BullMQ types so the retry / dead-letter rules can
 * be unit tested directly; the processor only translates the outcome for the queue.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  private readonly providers: Map<Channel, ChannelProvider>;

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly queue: DeliveryQueueService,
    @Inject(CHANNEL_PROVIDERS) providers: ChannelProvider[],
    private readonly metrics: MetricsService,
  ) {
    this.providers = new Map(providers.map((provider) => [provider.channel, provider]));
  }

  /**
   * @param isLastAttempt whether the queue will give up if this attempt fails
   */
  async deliver(notificationId: string, isLastAttempt: boolean): Promise<DeliveryOutcome> {
    const found = await this.repository.findById(notificationId);
    if (!found) return { kind: 'skipped', reason: 'notification not found' };
    // Idempotent consumer: a duplicated or late job must not send the message again.
    if (found.status === NotificationStatus.DELIVERED) {
      return { kind: 'skipped', reason: 'already delivered' };
    }

    const provider = this.providers.get(found.channel);
    if (!provider) throw new Error(`No provider registered for channel ${found.channel}`);

    const notification = await this.repository.markProcessing(found.id);
    const startedAt = Date.now();

    try {
      await provider.deliver(notification);
      const durationMs = Date.now() - startedAt;
      this.metrics.recordDelivery(notification.channel, 'delivered', durationMs);
      await this.repository.recordAttempt(notification, {
        success: true,
        durationMs,
        nextStatus: NotificationStatus.DELIVERED,
      });
      return { kind: 'delivered' };
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      const permanent = caught instanceof PermanentDeliveryError;
      const giveUp = permanent || isLastAttempt;
      const durationMs = Date.now() - startedAt;
      this.metrics.recordDelivery(
        notification.channel,
        giveUp ? 'dead_lettered' : 'retry',
        durationMs,
      );

      const updated = await this.repository.recordAttempt(notification, {
        success: false,
        error,
        durationMs,
        nextStatus: giveUp ? NotificationStatus.DEAD_LETTERED : NotificationStatus.FAILED,
      });

      if (!giveUp) return { kind: 'retry', error };

      this.logger.warn(`Notification ${notification.id} dead-lettered: ${error}`);
      await this.queue.deadLetter({
        notificationId: notification.id,
        reason: error,
        attempts: updated.attempts,
      });
      return { kind: 'dead-lettered', error, permanent };
    }
  }
}
