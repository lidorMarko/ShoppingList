import { Controller, Get, Post, Delete, Body, Param, Header, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { Principal } from './access-policy.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

@Controller('integrations/eden/credentials')
export class IntegrationCredentialsController {
  constructor(private readonly credentials: IntegrationCredentialsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: Principal) { return this.credentials.list(user.id); }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(@CurrentUser() user: Principal, @Body() body: unknown) { return this.credentials.create(user.id, body); }
  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  revoke(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.credentials.revoke(id, user.id); }
}
