import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEAD_LETTER_QUEUE, DELIVERY_QUEUE } from '../src/queue/queue.constants';

/**
 * Full path through PostgreSQL, Redis/BullMQ and a real HTTP receiver: API -> queue -> worker ->
 * webhook. Backoff is shortened so the retry scenarios finish in a couple of seconds.
 */
describe('Delivery pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let receiver: Server;
  let receiverUrl: string;
  /** Status codes the fake receiver answers with, in order; the last one repeats. */
  let script: number[] = [];
  let received: { headers: IncomingMessage['headers']; body: string }[] = [];

  beforeAll(async () => {
    Object.assign(process.env, {
      DELIVERY_MAX_ATTEMPTS: '3',
      DELIVERY_BACKOFF_MS: '50',
      SWEEP_INTERVAL_MS: '0',
      WEBHOOK_SIGNING_SECRET: 'e2e-secret',
    });

    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        const status = script.length > 1 ? script.shift()! : (script[0] ?? 200);
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await app.get<Queue>(getQueueToken(DELIVERY_QUEUE)).obliterate({ force: true });
    await app.get<Queue>(getQueueToken(DEAD_LETTER_QUEUE)).obliterate({ force: true });
  });

  beforeEach(async () => {
    script = [200];
    received = [];
    await prisma.notification.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => receiver.close(resolve));
  });

  async function send(payload: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('Idempotency-Key', `e2e-${randomUUID()}`)
      .send({ channel: 'WEBHOOK', recipient: receiverUrl, payload })
      .expect(202);
    return res.body.id as string;
  }

  async function waitForStatus(id: string, status: string, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
      if (row.status === status) return row;
      if (Date.now() > deadline) throw new Error(`Expected ${status}, still ${row.status}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('delivers a signed webhook', async () => {
    const id = await send({ orderId: 1 });

    const row = await waitForStatus(id, 'DELIVERED');

    expect(row.attempts).toBe(1);
    expect(received).toHaveLength(1);
    const expected = createHmac('sha256', 'e2e-secret').update(received[0].body).digest('hex');
    expect(received[0].headers['x-signature']).toBe(`sha256=${expected}`);
    expect(received[0].headers['x-notification-id']).toBe(id);
  });

  it('retries transient failures with backoff until it succeeds', async () => {
    script = [503, 503, 200];
    const id = await send({ orderId: 2 });

    const row = await waitForStatus(id, 'DELIVERED');

    expect(row.attempts).toBe(3);
    const attempts = await request(app.getHttpServer()).get(`/notifications/${id}/attempts`);
    expect(attempts.body.map((a: { success: boolean }) => a.success)).toEqual([false, false, true]);
  });

  it('dead-letters after exhausting retries, and can be retried manually', async () => {
    script = [500];
    const id = await send({ orderId: 3 });

    const dead = await waitForStatus(id, 'DEAD_LETTERED');
    expect(dead.attempts).toBe(3);
    expect(dead.lastError).toBe('Webhook answered 500');

    const deadLetters = await request(app.getHttpServer())
      .get('/notifications?status=DEAD_LETTERED')
      .expect(200);
    expect(deadLetters.body.map((n: { id: string }) => n.id)).toContain(id);

    // The receiver is "fixed": a manual retry goes through the queue again.
    script = [200];
    await request(app.getHttpServer()).post(`/notifications/${id}/retry`).expect(202);
    const delivered = await waitForStatus(id, 'DELIVERED');
    expect(delivered.attempts).toBe(4);
  });

  it('does not retry a permanent failure (4xx)', async () => {
    script = [404];
    const id = await send({ orderId: 4 });

    const dead = await waitForStatus(id, 'DEAD_LETTERED');

    expect(dead.attempts).toBe(1);
    expect(received).toHaveLength(1);
  });
});
