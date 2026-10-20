import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export type DeliveryResult = 'delivered' | 'retry' | 'dead_lettered';

/** Prometheus metrics. A dedicated registry keeps tests isolated from the global one. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly deliveries = new Counter({
    name: 'notification_deliveries_total',
    help: 'Delivery attempts by channel and result',
    labelNames: ['channel', 'result'] as const,
    registers: [this.registry],
  });

  private readonly duration = new Histogram({
    name: 'notification_delivery_duration_seconds',
    help: 'Time spent calling the channel provider',
    labelNames: ['channel'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordDelivery(channel: string, result: DeliveryResult, durationMs: number): void {
    this.deliveries.inc({ channel, result });
    this.duration.observe({ channel }, durationMs / 1000);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
