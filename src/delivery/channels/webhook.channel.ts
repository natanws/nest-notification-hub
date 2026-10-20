import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Notification } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { ChannelProvider, PermanentDeliveryError } from './channel';

/** Status codes worth retrying: timeouts, rate limiting and server-side errors. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * POSTs the payload as JSON to the recipient URL.
 *
 * Every request carries an HMAC-SHA256 signature of the body (X-Signature) and a delivery id
 * (X-Notification-Id), so the receiver can verify the sender and deduplicate retries.
 */
@Injectable()
export class WebhookChannel implements ChannelProvider {
  readonly channel = Channel.WEBHOOK;

  constructor(private readonly config: ConfigService) {}

  async deliver(notification: Notification): Promise<void> {
    const body = JSON.stringify(notification.payload);
    const secret = this.config.getOrThrow<string>('WEBHOOK_SIGNING_SECRET');
    const timeoutMs = Number(this.config.get('DELIVERY_TIMEOUT_MS', 5000));

    let response: Response;
    try {
      response = await fetch(notification.recipient, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Notification-Id': notification.id,
          'X-Signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Network error or timeout: the receiver may be temporarily down, so retry.
      throw new Error(`Webhook request failed: ${(error as Error).message}`);
    }

    if (response.ok) return;

    const message = `Webhook answered ${response.status}`;
    throw isRetryable(response.status) ? new Error(message) : new PermanentDeliveryError(message);
  }
}
