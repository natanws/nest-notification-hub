import { Injectable } from '@nestjs/common';
import { DeliveryAttempt, Notification, NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type NewNotification = Pick<
  Notification,
  'idempotencyKey' | 'requestHash' | 'channel' | 'recipient'
> & { payload: Prisma.InputJsonValue };

/** Thin data-access layer, so the service can be unit tested without a database. */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { idempotencyKey } });
  }

  create(data: NewNotification): Promise<Notification> {
    return this.prisma.notification.create({ data });
  }

  findAttempts(notificationId: string): Promise<DeliveryAttempt[]> {
    return this.prisma.deliveryAttempt.findMany({
      where: { notificationId },
      orderBy: { attempt: 'asc' },
    });
  }

  findByStatus(status: NotificationStatus, take = 50): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** PENDING notifications older than `olderThan` (their enqueue may have been lost). */
  findStalePending(olderThan: Date, take = 100): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { status: NotificationStatus.PENDING, createdAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  markProcessing(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { status: NotificationStatus.PROCESSING },
    });
  }

  /** Stores one attempt and the resulting notification state atomically. */
  async recordAttempt(
    notification: Notification,
    result: {
      success: boolean;
      error?: string;
      durationMs: number;
      nextStatus: NotificationStatus;
    },
  ): Promise<Notification> {
    const attempt = notification.attempts + 1;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.deliveryAttempt.create({
        data: {
          notificationId: notification.id,
          attempt,
          success: result.success,
          error: result.error,
          durationMs: result.durationMs,
        },
      }),
      this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          attempts: attempt,
          status: result.nextStatus,
          lastError: result.success ? null : result.error,
          deliveredAt: result.success ? new Date() : undefined,
        },
      }),
    ]);
    return updated;
  }

  /** Moves a dead-lettered notification back to PENDING, only if it is still dead-lettered. */
  async resetDeadLettered(id: string): Promise<boolean> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, status: NotificationStatus.DEAD_LETTERED },
      data: { status: NotificationStatus.PENDING },
    });
    return count === 1;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
