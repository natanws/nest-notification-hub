import { Channel, Notification, NotificationStatus } from '@prisma/client';
import { NotificationsRepository } from '../notifications/notifications.repository';
import { MetricsService } from '../metrics/metrics.service';
import { DeliveryQueueService } from '../queue/delivery-queue.service';
import { ChannelProvider, PermanentDeliveryError } from './channels/channel';
import { DeliveryService } from './delivery.service';

const ID = '7f1c1e0e-0000-4000-8000-000000000001';

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: ID,
    idempotencyKey: 'key-123456',
    requestHash: 'hash',
    channel: Channel.WEBHOOK,
    recipient: 'https://example.com/hook',
    payload: { orderId: 42 },
    status: NotificationStatus.PENDING,
    attempts: 0,
    lastError: null,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DeliveryService', () => {
  let repository: jest.Mocked<NotificationsRepository>;
  let queue: jest.Mocked<DeliveryQueueService>;
  let webhook: jest.Mocked<ChannelProvider>;
  let metrics: jest.Mocked<MetricsService>;
  let service: DeliveryService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(notification()),
      markProcessing: jest.fn().mockResolvedValue(notification({ status: 'PROCESSING' })),
      recordAttempt: jest.fn().mockResolvedValue(notification({ attempts: 1 })),
    } as unknown as jest.Mocked<NotificationsRepository>;
    queue = { deadLetter: jest.fn() } as unknown as jest.Mocked<DeliveryQueueService>;
    webhook = { channel: Channel.WEBHOOK, deliver: jest.fn() };
    metrics = { recordDelivery: jest.fn() } as unknown as jest.Mocked<MetricsService>;
    service = new DeliveryService(repository, queue, [webhook], metrics);
  });

  it('marks the notification as delivered when the channel succeeds', async () => {
    webhook.deliver.mockResolvedValue();

    await expect(service.deliver(ID, false)).resolves.toEqual({ kind: 'delivered' });
    expect(metrics.recordDelivery).toHaveBeenCalledWith(
      Channel.WEBHOOK,
      'delivered',
      expect.any(Number),
    );
    expect(repository.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID }),
      expect.objectContaining({ success: true, nextStatus: NotificationStatus.DELIVERED }),
    );
  });

  it('asks for a retry on a transient failure that is not the last attempt', async () => {
    webhook.deliver.mockRejectedValue(new Error('Webhook answered 503'));

    await expect(service.deliver(ID, false)).resolves.toEqual({
      kind: 'retry',
      error: 'Webhook answered 503',
    });
    expect(repository.recordAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ success: false, nextStatus: NotificationStatus.FAILED }),
    );
    expect(queue.deadLetter).not.toHaveBeenCalled();
  });

  it('dead-letters after the last attempt fails', async () => {
    webhook.deliver.mockRejectedValue(new Error('Webhook answered 503'));
    repository.recordAttempt.mockResolvedValue(notification({ attempts: 5 }));

    const outcome = await service.deliver(ID, true);

    expect(outcome).toEqual({
      kind: 'dead-lettered',
      error: 'Webhook answered 503',
      permanent: false,
    });
    expect(queue.deadLetter).toHaveBeenCalledWith({
      notificationId: ID,
      reason: 'Webhook answered 503',
      attempts: 5,
    });
  });

  it('dead-letters a permanent failure immediately, even with attempts left', async () => {
    webhook.deliver.mockRejectedValue(new PermanentDeliveryError('Webhook answered 404'));

    const outcome = await service.deliver(ID, false);

    expect(outcome).toMatchObject({ kind: 'dead-lettered', permanent: true });
    expect(repository.recordAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nextStatus: NotificationStatus.DEAD_LETTERED }),
    );
  });

  it('does not send an already delivered notification again (idempotent consumer)', async () => {
    repository.findById.mockResolvedValue(notification({ status: NotificationStatus.DELIVERED }));

    await expect(service.deliver(ID, false)).resolves.toEqual({
      kind: 'skipped',
      reason: 'already delivered',
    });
    expect(webhook.deliver).not.toHaveBeenCalled();
  });

  it('skips jobs whose notification no longer exists', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.deliver(ID, false)).resolves.toMatchObject({ kind: 'skipped' });
  });

  it('fails loudly when a channel has no provider registered', async () => {
    repository.findById.mockResolvedValue(notification({ channel: Channel.EMAIL }));

    await expect(service.deliver(ID, false)).rejects.toThrow('No provider registered');
  });
});
