import { ConflictException, NotFoundException } from '@nestjs/common';
import { Channel, Notification, Prisma } from '@prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { DeliveryQueueService } from '../queue/delivery-queue.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { hashRequest } from './request-hash';

const dto: CreateNotificationDto = {
  channel: Channel.WEBHOOK,
  recipient: 'https://example.com/hook',
  payload: { orderId: 42 },
};

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '7f1c1e0e-0000-4000-8000-000000000001',
    idempotencyKey: 'order-42-created',
    requestHash: hashRequest({ ...dto }),
    channel: dto.channel,
    recipient: dto.recipient,
    payload: dto.payload as Prisma.JsonValue,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('NotificationsService', () => {
  let repository: jest.Mocked<NotificationsRepository>;
  let queue: jest.Mocked<DeliveryQueueService>;
  let service: NotificationsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      create: jest.fn(),
      findAttempts: jest.fn(),
      findByStatus: jest.fn(),
      resetDeadLettered: jest.fn(),
    } as unknown as jest.Mocked<NotificationsRepository>;
    queue = { enqueue: jest.fn() } as unknown as jest.Mocked<DeliveryQueueService>;
    service = new NotificationsService(repository, queue);
  });

  describe('create', () => {
    it('stores a new notification when the key was never used', async () => {
      repository.findByIdempotencyKey.mockResolvedValue(null);
      repository.create.mockResolvedValue(notification());

      const result = await service.create('order-42-created', dto);

      expect(result.created).toBe(true);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'order-42-created', channel: Channel.WEBHOOK }),
      );
      expect(queue.enqueue).toHaveBeenCalledWith(result.notification.id);
    });

    it('still accepts the notification when the queue is unavailable', async () => {
      repository.findByIdempotencyKey.mockResolvedValue(null);
      repository.create.mockResolvedValue(notification());
      queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.create('order-42-created', dto)).resolves.toMatchObject({
        created: true,
      });
    });

    it('returns the stored notification when the same request is replayed', async () => {
      const stored = notification();
      repository.findByIdempotencyKey.mockResolvedValue(stored);

      const result = await service.create('order-42-created', { ...dto });

      expect(result).toEqual({ notification: stored, created: false });
      expect(repository.create).not.toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a reused key with a different body', async () => {
      repository.findByIdempotencyKey.mockResolvedValue(notification());

      await expect(
        service.create('order-42-created', { ...dto, payload: { orderId: 43 } }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('resolves a concurrent insert race to the winning row', async () => {
      const winner = notification();
      repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      repository.create.mockRejectedValue(uniqueViolation());

      const result = await service.create('order-42-created', dto);

      expect(result).toEqual({ notification: winner, created: false });
    });

    it('rethrows errors that are not unique violations', async () => {
      repository.findByIdempotencyKey.mockResolvedValue(null);
      repository.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.create('order-42-created', dto)).rejects.toThrow('connection lost');
    });
  });

  describe('findOne / findAttempts', () => {
    it('throws 404 for an unknown id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findAttempts('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the attempts of an existing notification', async () => {
      repository.findById.mockResolvedValue(notification());
      repository.findAttempts.mockResolvedValue([]);

      await expect(service.findAttempts('7f1c1e0e-0000-4000-8000-000000000001')).resolves.toEqual(
        [],
      );
    });
  });

  describe('retry', () => {
    it('re-enqueues a dead-lettered notification with a fresh job id', async () => {
      repository.findById.mockResolvedValue(notification({ status: 'DEAD_LETTERED' }));
      repository.resetDeadLettered.mockResolvedValue(true);

      await service.retry('7f1c1e0e-0000-4000-8000-000000000001');

      expect(queue.enqueue).toHaveBeenCalledWith(
        '7f1c1e0e-0000-4000-8000-000000000001',
        expect.stringMatching(/-retry-\d+$/),
      );
    });

    it('refuses to retry a notification that is not dead-lettered', async () => {
      repository.findById.mockResolvedValue(notification({ status: 'DELIVERED' }));
      repository.resetDeadLettered.mockResolvedValue(false);

      await expect(service.retry('7f1c1e0e-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });
});
