import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('exposes delivery counters and durations in Prometheus format', async () => {
    const metrics = new MetricsService();

    metrics.recordDelivery('WEBHOOK', 'delivered', 120);
    metrics.recordDelivery('WEBHOOK', 'retry', 3000);

    const output = await metrics.metrics();
    expect(output).toContain(
      'notification_deliveries_total{channel="WEBHOOK",result="delivered"} 1',
    );
    expect(output).toContain('notification_deliveries_total{channel="WEBHOOK",result="retry"} 1');
    expect(output).toContain('notification_delivery_duration_seconds_count{channel="WEBHOOK"} 2');
  });
});
