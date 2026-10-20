import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DeliveryModule } from './delivery/delivery.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    NotificationsModule,
    DeliveryModule,
  ],
})
export class AppModule {}
