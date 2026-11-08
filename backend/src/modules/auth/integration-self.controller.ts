import { Controller, Get, Delete, Header } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { Principal } from './access-policy.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

// Phase C: an integration credential may describe or revoke ONLY itself. Identity comes from the
// verified bearer credential, never from a path/body ID. Web sessions are denied (AccessPolicy);
// they manage credentials through IntegrationCredentialsController instead.
@Controller('integrations/eden/self')
export class IntegrationSelfController {
  constructor(private readonly credentials: IntegrationCredentialsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  inspect(@CurrentUser() user: Principal) { return this.credentials.inspectSelf(user); }
  @Delete()
  @Header('Cache-Control', 'no-store')
  revoke(@CurrentUser() user: Principal) { return this.credentials.revokeSelf(user); }
}
