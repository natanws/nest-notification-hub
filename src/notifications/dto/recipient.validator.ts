import { Channel } from '@prisma/client';
import {
  isEmail,
  isURL,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

const rules: Record<Channel, { check: (value: string) => boolean; message: string }> = {
  [Channel.WEBHOOK]: {
    check: (value) =>
      isURL(value, { protocols: ['https', 'http'], require_protocol: true, require_tld: false }),
    message: 'recipient must be an http(s) URL for the WEBHOOK channel',
  },
  [Channel.EMAIL]: {
    check: (value) => isEmail(value),
    message: 'recipient must be an e-mail address for the EMAIL channel',
  },
  [Channel.WHATSAPP]: {
    check: (value) => E164.test(value),
    message:
      'recipient must be an E.164 phone number (e.g. +5551999999999) for the WHATSAPP channel',
  },
};

/** Validates `recipient` against the format the sibling `channel` field expects. */
export function IsRecipientForChannel(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isRecipientForChannel',
      target: target.constructor,
      propertyName: propertyName.toString(),
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const channel = (args.object as { channel?: Channel }).channel;
          const rule = channel ? rules[channel] : undefined;
          // An invalid/missing channel is reported by the channel's own validator.
          return rule === undefined || (typeof value === 'string' && rule.check(value));
        },
        defaultMessage(args: ValidationArguments): string {
          const channel = (args.object as { channel?: Channel }).channel;
          return channel && rules[channel] ? rules[channel].message : 'invalid recipient';
        },
      },
    });
  };
}
