import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** Runs against a real PostgreSQL (docker compose locally, a service container in CI). */
describe('Notifications API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const body = {
    channel: 'WEBHOOK',
    recipient: 'https://example.com/hooks/orders',
    payload: { orderId: 42, status: 'paid' },
  };

  it('accepts a notification once and replays it for the same key', async () => {
    const key = `order-${randomUUID()}`;

    const first = await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(202);

    expect(first.body).toMatchObject({ channel: 'WEBHOOK', status: 'PENDING', attempts: 0 });
    expect(first.body).not.toHaveProperty('requestHash');

    const replay = await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', key)
      .send({ ...body, payload: { status: 'paid', orderId: 42 } }) // same content, other key order
      .expect(200);

    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('returns 409 when a key is reused with a different body', async () => {
    const key = `order-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', key)
      .send(body);

    await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', key)
      .send({ ...body, payload: { orderId: 43 } })
      .expect(409);
  });

  it('creates a single row when the same request races itself', async () => {
    const key = `order-${randomUUID()}`;
    const send = () =>
      request(app.getHttpServer()).post('/notifications').set('Idempotency-Key', key).send(body);

    const responses = await Promise.all([send(), send(), send(), send(), send()]);

    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(responses.every((r) => [200, 202].includes(r.status))).toBe(true);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('validates the header, the channel/recipient pair and unknown fields', async () => {
    await request(app.getHttpServer()).post('/notifications').send(body).expect(400);

    await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', `order-${randomUUID()}`)
      .send({ ...body, channel: 'EMAIL' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', `order-${randomUUID()}`)
      .send({ ...body, priority: 'high' })
      .expect(400);
  });

  it('exposes the notification and its (empty) attempt log', async () => {
    const created = await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', `order-${randomUUID()}`)
      .send(body);

    await request(app.getHttpServer()).get(`/notifications/${created.body.id}`).expect(200);
    const attempts = await request(app.getHttpServer())
      .get(`/notifications/${created.body.id}/attempts`)
      .expect(200);
    expect(attempts.body).toEqual([]);

    await request(app.getHttpServer()).get(`/notifications/${randomUUID()}`).expect(404);
    await request(app.getHttpServer()).get('/notifications/not-a-uuid').expect(400);
  });
});
