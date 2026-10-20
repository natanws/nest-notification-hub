import { Notification } from '@prisma/client';

export type NotificationResponse = Omit<Notification, 'requestHash' | 'idempotencyKey'>;

/** Keeps internal bookkeeping fields out of the public API. */
export function toResponse(notification: Notification): NotificationResponse {
  const { requestHash: _hash, idempotencyKey: _key, ...rest } = notification;
  return rest;
}
