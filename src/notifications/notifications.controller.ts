import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { DeliveryAttempt } from '@prisma/client';
import { Response } from 'express';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { IdempotencyKey } from './idempotency-key.decorator';
import { NotificationResponse, toResponse } from './notification.response';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** 202 when the notification was accepted now, 200 when this is a replay of the same request. */
  @Post()
  async create(
    @IdempotencyKey() key: string,
    @Body() dto: CreateNotificationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NotificationResponse> {
    const { notification, created } = await this.notifications.create(key, dto);
    res.status(created ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return toResponse(notification);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<NotificationResponse> {
    return toResponse(await this.notifications.findOne(id));
  }

  @Get(':id/attempts')
  findAttempts(@Param('id', ParseUUIDPipe) id: string): Promise<DeliveryAttempt[]> {
    return this.notifications.findAttempts(id);
  }
}
