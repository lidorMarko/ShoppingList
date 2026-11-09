import { Injectable, BadRequestException, UnauthorizedException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { IntegrationCredential } from '../../database/entities/integration-credential.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Principal } from './access-policy.service';

@Injectable()
export class IntegrationCredentialsService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}
  private enabled() {
    if (this.config.get('EDEN_INTEGRATION_ENABLED') !== 'true') throw new NotFoundException();
  }
  async verify(token: string): Promise<Principal> {
    this.enabled();
    const match = /^eden_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) throw new UnauthorizedException();
    const row = await this.db.getRepository(IntegrationCredential).findOne({ where: { id: match[1] }, select: ['id', 'userId', 'tokenHash', 'scopes', 'expiresAt', 'revokedAt'] });
    const digest = createHash('sha256').update(token).digest();
    const expected = row && /^[a-f0-9]{64}$/.test(row.tokenHash) ? Buffer.from(row.tokenHash, 'hex') : Buffer.alloc(32);
    const valid = timingSafeEqual(digest, expected);
    if (!row || !valid || row.revokedAt || row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    // Supabase account lifecycle is independent of the local profile. Do not keep
    // accepting credentials after Auth deletion/ban while a profile still exists.
    const accounts = await this.db.query(
      'SELECT id FROM auth.users WHERE id = $1::uuid AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until <= now())',
      [row.userId],
    );
    if (accounts.length !== 1) throw new UnauthorizedException();
    const profile = await this.db.getRepository(Profile).findOneBy({ id: row.userId });
    if (!profile) throw new UnauthorizedException();
    return { id: profile.id, email: profile.email, kind: 'integration', emailVerified: false, scopes: row.scopes, credentialId: row.id };
  }
  async list(userId: string) {
    this.enabled();
    return this.db.getRepository(IntegrationCredential).find({ where: { userId }, select: ['id', 'scopes', 'createdAt', 'expiresAt', 'revokedAt'], order: { createdAt: 'DESC' } });
  }
  async create(userId: string, body: any) {
    this.enabled();
    const scopes = body?.scopes;
    const validScopes = Array.isArray(scopes) && (JSON.stringify(scopes) === '["shopping:read"]' || JSON.stringify(scopes) === '["shopping:read","shopping:write"]');
    if (body?.application !== 'eden' || body?.consent !== true || !validScopes || (body.expiresInDays !== undefined && (!Number.isInteger(body.expiresInDays) || body.expiresInDays < 1 || body.expiresInDays > 90)) || Object.keys(body).some(k => !['application', 'consent', 'scopes', 'expiresInDays', 'rotateCredentialId'].includes(k))) throw new BadRequestException('Explicit Eden scope consent and a valid expiry are required');
    const id = randomUUID();
    const token = `eden_${id}_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + (body.expiresInDays ?? 30) * 86400000);
    await this.db.transaction(async manager => {
      if (!await manager.getRepository(Profile).existsBy({ id: userId })) throw new UnauthorizedException();
      if (body.rotateCredentialId !== undefined) {
        if (typeof body.rotateCredentialId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.rotateCredentialId)) throw new BadRequestException();
        const old = await manager.getRepository(IntegrationCredential).findOne({ where: { id: body.rotateCredentialId, userId }, lock: { mode: 'pessimistic_write' } });
        if (!old || old.revokedAt) throw new NotFoundException();
        await manager.getRepository(IntegrationCredential).update({ id: old.id, userId }, { revokedAt: new Date() });
      }
      await manager.getRepository(IntegrationCredential).insert({ id, userId, tokenHash: createHash('sha256').update(token).digest('hex'), scopes, expiresAt });
    });
    // Returned once to the authenticated setup UI, never persisted in plaintext.
    return { id, token, scopes, expiresAt };
  }
  /** Non-secret metadata for the presenting credential only: lets a host bind its stored
   * credential to the verified account, scope and expiry instead of operator-typed claims. */
  async inspectSelf(principal: Principal) {
    this.enabled();
    if (principal.kind !== 'integration' || !principal.credentialId) throw new ForbiddenException();
    const row = await this.db.getRepository(IntegrationCredential).findOne({ where: { id: principal.credentialId, userId: principal.id }, select: ['id', 'userId', 'scopes', 'expiresAt', 'revokedAt'] });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    return { credentialId: row.id, userId: row.userId, scopes: row.scopes, expiresAt: row.expiresAt, mutationProtocol: 'phase-d-v1' };
  }
  /** Revokes the presenting credential. It cannot name or affect any other credential. */
  async revokeSelf(principal: Principal) {
    this.enabled();
    if (principal.kind !== 'integration' || !principal.credentialId) throw new ForbiddenException();
    const result = await this.db.getRepository(IntegrationCredential).update({ id: principal.credentialId, userId: principal.id, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw new UnauthorizedException();
    return { revoked: true };
  }
  async revoke(id: string, userId: string) {
    this.enabled();
    const result = await this.db.getRepository(IntegrationCredential).update({ id, userId }, { revokedAt: new Date() });
    if (!result.affected) throw new NotFoundException();
    return { revoked: true };
  }
}
