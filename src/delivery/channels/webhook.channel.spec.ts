import { ConfigService } from '@nestjs/config';
import { Channel, Notification } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PermanentDeliveryError } from './channel';
import { WebhookChannel } from './webhook.channel';

const notification = {
  id: '7f1c1e0e-0000-4000-8000-000000000001',
  channel: Channel.WEBHOOK,
  recipient: 'https://example.com/hook',
  payload: { orderId: 42 },
} as unknown as Notification;

describe('WebhookChannel', () => {
  const config = new ConfigService({
    WEBHOOK_SIGNING_SECRET: 'test-secret',
    DELIVERY_TIMEOUT_MS: 1000,
  });
  const channel = new WebhookChannel(config);
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('posts the payload with an HMAC signature and the notification id', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await channel.deliver(notification);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.stringify({ orderId: 42 });
    expect(url).toBe('https://example.com/hook');
    expect(init.body).toBe(body);
    expect(init.headers).toMatchObject({
      'X-Notification-Id': notification.id,
      'X-Signature': `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`,
    });
  });

  it.each([500, 502, 503, 408, 429])('treats HTTP %i as retryable', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));

    const error = await channel.deliver(notification).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentDeliveryError);
  });

  it.each([400, 401, 404, 410, 422])('treats HTTP %i as permanent', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));

    await expect(channel.deliver(notification)).rejects.toBeInstanceOf(PermanentDeliveryError);
  });

  it('treats network errors and timeouts as retryable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const error = await channel.deliver(notification).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(PermanentDeliveryError);
    expect((error as Error).message).toContain('fetch failed');
  });
});
