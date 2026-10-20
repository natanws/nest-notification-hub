import { Injectable, Logger } from '@nestjs/common';
import { Channel, Notification } from '@prisma/client';
import { ChannelProvider } from './channel';

/**
 * Stand-in for real e-mail / WhatsApp providers (SES, SendGrid, WhatsApp Cloud API...).
 * It only logs, which keeps the project runnable without third-party accounts. A real provider
 * implements the same ChannelProvider interface and is registered in DeliveryModule.
 */
abstract class SandboxChannel implements ChannelProvider {
  abstract readonly channel: Channel;
  private readonly logger = new Logger(this.constructor.name);

  async deliver(notification: Notification): Promise<void> {
    this.logger.log(`[sandbox] ${this.channel} notification ${notification.id} delivered`);
  }
}

@Injectable()
export class EmailSandboxChannel extends SandboxChannel {
  readonly channel = Channel.EMAIL;
}

@Injectable()
export class WhatsAppSandboxChannel extends SandboxChannel {
  readonly channel = Channel.WHATSAPP;
}
