import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { DELIVERY_QUEUE } from '../queue/queue.constants';
import { HealthController } from './health.controller';

async function controllerWith(dbUp: boolean, redisUp: boolean): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [
      {
        provide: PrismaService,
        useValue: {
          $queryRaw: () => (dbUp ? Promise.resolve([1]) : Promise.reject(new Error('db down'))),
        },
      },
      {
        provide: getQueueToken(DELIVERY_QUEUE),
        useValue: {
          getJobCounts: () =>
            redisUp ? Promise.resolve({ waiting: 0 }) : Promise.reject(new Error('redis down')),
        },
      },
    ],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports ok when PostgreSQL and Redis answer', async () => {
    const result = await (await controllerWith(true, true)).check();

    expect(result.status).toBe('ok');
    expect(Object.keys(result.details)).toEqual(['database', 'queue']);
  });

  it('returns 503 when a dependency is down', async () => {
    const controller = await controllerWith(true, false);

    await expect(controller.check()).rejects.toMatchObject({ status: 503 });
  });
});
