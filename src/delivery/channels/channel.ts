import { Channel, Notification } from '@prisma/client';

/**
 * A delivery failure that will not succeed on retry (e.g. the receiver answered 400 or 404).
 * The worker sends these straight to the dead-letter queue instead of burning retries.
 */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

export interface ChannelProvider {
  readonly channel: Channel;
  /** Resolves on success; throws on failure (PermanentDeliveryError when retrying is pointless). */
  deliver(notification: Notification): Promise<void>;
}

export const CHANNEL_PROVIDERS = Symbol('CHANNEL_PROVIDERS');
