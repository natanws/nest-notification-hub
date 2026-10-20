import { Injectable } from '@nestjs/common';
import { DeliveryAttempt, Notification, Prisma } from '@prisma/client';
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
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
