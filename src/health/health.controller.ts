import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DELIVERY_QUEUE } from '../queue/queue.constants';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @InjectQueue(DELIVERY_QUEUE) private readonly queue: Queue,
  ) {}

  /** Readiness: the service is only useful if it can reach PostgreSQL and Redis. */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      () =>
        // Any round-trip to Redis proves the queue backend is reachable.
        this.probe('queue', () => this.queue.getJobCounts('waiting')),
    ]);
  }

  private async probe(key: string, ping: () => Promise<unknown>) {
    const session = this.indicator.check(key);
    try {
      await ping();
      return session.up();
    } catch (error) {
      return session.down({ message: (error as Error).message });
    }
  }
}
