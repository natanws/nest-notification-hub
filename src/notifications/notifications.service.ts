import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryAttempt, Notification, Prisma } from '@prisma/client';
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
  constructor(private readonly repository: NotificationsRepository) {}

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

  private assertSameRequest(notification: Notification, requestHash: string): Notification {
    if (notification.requestHash !== requestHash) {
      throw new ConflictException('Idempotency-Key was already used with a different request body');
    }
    return notification;
  }
}
