import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeliveryAttempt, Notification, NotificationStatus, Prisma } from '@prisma/client';
import { DeliveryQueueService } from '../queue/delivery-queue.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { isUniqueViolation, NotificationsRepository } from './notifications.repository';
import { hashRequest } from './request-hash';

export interface CreateResult {
  notification: Notification;
  /** false when the request was a replay of an existing idempotency key. */
  created: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly queue: DeliveryQueueService,
  ) {}

  /**
   * Creates a notification exactly once per idempotency key.
   *
   * - Same key + same body: returns the stored notification (safe client retry).
   * - Same key + different body: 409, because the client is reusing a key by mistake.
   */
  async create(idempotencyKey: string, dto: CreateNotificationDto): Promise<CreateResult> {
    const requestHash = hashRequest({ ...dto });

    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { notification: this.assertSameRequest(existing, requestHash), created: false };
    }

    try {
      const notification = await this.repository.create({
        idempotencyKey,
        requestHash,
        channel: dto.channel,
        recipient: dto.recipient,
        payload: dto.payload as Prisma.InputJsonValue,
      });
      await this.enqueueSafely(notification.id);
      return { notification, created: true };
    } catch (error) {
      // Two concurrent requests with the same key: the unique index lets only one insert win.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.repository.findByIdempotencyKey(idempotencyKey);
      if (!winner) throw error;
      return { notification: this.assertSameRequest(winner, requestHash), created: false };
    }
  }

  async findOne(id: string): Promise<Notification> {
    const notification = await this.repository.findById(id);
    if (!notification) throw new NotFoundException(`Notification ${id} not found`);
    return notification;
  }

  async findAttempts(id: string): Promise<DeliveryAttempt[]> {
    await this.findOne(id);
    return this.repository.findAttempts(id);
  }

  listByStatus(status: NotificationStatus): Promise<Notification[]> {
    return this.repository.findByStatus(status);
  }

  /** Sends a dead-lettered notification through the queue again (e.g. after fixing the receiver). */
  async retry(id: string): Promise<Notification> {
    await this.findOne(id);
    if (!(await this.repository.resetDeadLettered(id))) {
      throw new ConflictException('Only dead-lettered notifications can be retried');
    }
    // A fresh job id: the original job is kept in the failed set for inspection.
    await this.queue.enqueue(id, `${id}-retry-${Date.now()}`);
    return this.findOne(id);
  }

  /**
   * The row is already committed, so a Redis outage must not turn this into a 500 (the client
   * would retry and get a replay anyway). The pending sweeper re-enqueues it later.
   */
  private async enqueueSafely(id: string): Promise<void> {
    try {
      await this.queue.enqueue(id);
    } catch (error) {
      this.logger.error(
        `Could not enqueue ${id}, the sweeper will retry: ${(error as Error).message}`,
      );
    }
  }

  private assertSameRequest(notification: Notification, requestHash: string): Notification {
    if (notification.requestHash !== requestHash) {
      throw new ConflictException('Idempotency-Key was already used with a different request body');
    }
    return notification;
  }
}
