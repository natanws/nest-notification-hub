import { Channel } from '@prisma/client';
import { IsEnum, IsObject, IsString, MaxLength } from 'class-validator';
import { IsRecipientForChannel } from './recipient.validator';

export class CreateNotificationDto {
  @IsEnum(Channel)
  channel!: Channel;

  /** Webhook URL, e-mail address or E.164 phone number, depending on the channel. */
  @IsString()
  @MaxLength(2048)
  @IsRecipientForChannel()
  recipient!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
