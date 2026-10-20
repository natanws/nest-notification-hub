import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok when there are no failing indicators', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    const result = await moduleRef.get(HealthController).check();

    expect(result.status).toBe('ok');
  });
});
