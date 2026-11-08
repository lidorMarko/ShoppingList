import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AccessPolicy, Principal } from './access-policy.service';
import { IntegrationCredentialsService } from './integration-credentials.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService, private readonly policy: AccessPolicy, private readonly credentials: IntegrationCredentialsService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const controller = context.getClass().name, handler = context.getHandler().name;
    if (controller === 'AuthController' && handler === 'validateInvite') return true;
    const req = context.switchToHttp().getRequest();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [^\s]{1,4096}$/.test(header)) throw new UnauthorizedException();
    const token = header.slice(7);
    let user: Principal;
    if (token.startsWith('eden_')) user = await this.credentials.verify(token);
    else {
      try {
        const client = createClient(this.config.get<string>('SUPABASE_URL'), this.config.get<string>('SUPABASE_PUBLISHABLE_KEY') || this.config.get<string>('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const { data, error } = await client.auth.getUser(token);
        if (error || !data.user) throw new Error();
        user = { id: data.user.id, email: data.user.email, kind: 'web', scopes: [], emailVerified: !!data.user.email_confirmed_at };
      } catch { throw new UnauthorizedException(); }
    }
    // TypeORM ignores undefined where values; validate resource IDs before policy queries.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const requireId = (value: unknown) => {
      if (typeof value !== 'string' || !uuid.test(value)) throw new BadRequestException('Invalid resource identifier');
    };
    for (const [key, value] of Object.entries(req.params || {})) if (key.toLowerCase().endsWith('id')) requireId(value);
    const requiredFields: Record<string, string> = {
      'ListsController.copyItems': 'targetListId',
      'ListItemsController.create': 'productId',
      'SessionsController.create': 'shoppingListId',
      'SessionsController.addItem': 'productId',
    };
    const required = requiredFields[`${controller}.${handler}`];
    if (required) requireId(req.body?.[required]);
    for (const key of ['productId', 'targetListId', 'shoppingListId', 'categoryId']) {
      if (key === 'categoryId' && req.body?.[key] === null) continue;
      if (req.body?.[key] !== undefined) requireId(req.body[key]);
    }
    await this.policy.authorize(controller, handler, req, user, true);
    req.user = user;
    return true;
  }
}
