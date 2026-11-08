import { Controller, Get, Param, Headers } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Principal } from '../auth/access-policy.service';
import { ReliableShoppingService } from './reliable-shopping.service';

@Controller('integration/operations')
export class OperationsController {
  constructor(private readonly reliable: ReliableShoppingService) {}
  @Get('by-key')
  findByKey(@CurrentUser() user: Principal, @Headers('idempotency-key') key: string) { return this.reliable.lookup(user, undefined, key); }
  @Get(':operationId')
  findOne(@CurrentUser() user: Principal, @Param('operationId') operationId: string) { return this.reliable.lookup(user, operationId); }
}
