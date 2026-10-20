import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateNotificationDto } from './create-notification.dto';

function errorsFor(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateNotificationDto, body);
  return validateSync(dto).map((error) => error.property);
}

describe('CreateNotificationDto', () => {
  it.each([
    ['WEBHOOK', 'https://example.com/hooks/orders'],
    ['EMAIL', 'ana@example.com'],
    ['WHATSAPP', '+5551999999999'],
  ])('accepts a valid %s recipient', (channel, recipient) => {
    expect(errorsFor({ channel, recipient, payload: { text: 'hi' } })).toEqual([]);
  });

  it.each([
    ['WEBHOOK', 'not-a-url'],
    ['EMAIL', 'https://example.com'],
    ['WHATSAPP', '51999999999'],
  ])('rejects a %s recipient in the wrong format', (channel, recipient) => {
    expect(errorsFor({ channel, recipient, payload: {} })).toEqual(['recipient']);
  });

  it('rejects an unknown channel and a non-object payload', () => {
    expect(errorsFor({ channel: 'SMS', recipient: 'x', payload: 'text' }).sort()).toEqual([
      'channel',
      'payload',
    ]);
  });
});
