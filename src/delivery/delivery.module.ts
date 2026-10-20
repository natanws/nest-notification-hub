import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { CHANNEL_PROVIDERS, ChannelProvider } from './channels/channel';
import { EmailSandboxChannel, WhatsAppSandboxChannel } from './channels/sandbox.channel';
import { WebhookChannel } from './channels/webhook.channel';
import { DeliveryProcessor } from './delivery.processor';
import { DeliveryService } from './delivery.service';
import { PendingSweeperService } from './pending-sweeper.service';

@Module({
  imports: [NotificationsModule, QueueModule],
  providers: [
    WebhookChannel,
    EmailSandboxChannel,
    WhatsAppSandboxChannel,
    {
      provide: CHANNEL_PROVIDERS,
      inject: [WebhookChannel, EmailSandboxChannel, WhatsAppSandboxChannel],
      useFactory: (...providers: ChannelProvider[]) => providers,
    },
    DeliveryService,
    DeliveryProcessor,
    PendingSweeperService,
  ],
})
export class DeliveryModule {}
