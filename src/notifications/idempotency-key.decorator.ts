import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

const VALID_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Reads and validates the Idempotency-Key request header. */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const key = request.header('idempotency-key');
  if (!key || !VALID_KEY.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key header is required (8-128 chars: letters, digits, dash or underscore)',
    );
  }
  return key;
});
