export const DELIVERY_QUEUE = 'notifications';
export const DEAD_LETTER_QUEUE = 'notifications-dead-letter';
export const DELIVER_JOB = 'deliver';

export interface DeliveryJobData {
  notificationId: string;
}

export interface DeadLetterJobData {
  notificationId: string;
  reason: string;
  attempts: number;
}
