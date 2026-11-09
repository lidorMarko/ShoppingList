import { Injectable, BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AccessPolicy, Principal } from '../auth/access-policy.service';
import { IntegrationCredential } from '../../database/entities/integration-credential.entity';
import { ShoppingOperationRecord } from '../../database/entities/shopping-operation.entity';
import { ShoppingList } from '../../database/entities/shopping-list.entity';
import { ListItem } from '../../database/entities/list-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { ListsService } from '../lists/lists.service';
import { ListItemsService } from '../list-items/list-items.service';
import { CreateListDto } from '../lists/dto/create-list.dto';
import { UpdateListDto } from '../lists/dto/update-list.dto';
import { CopyListDto } from '../lists/dto/copy-list.dto';
import { CreateListItemDto } from '../list-items/dto/create-list-item.dto';
import { UpdateListItemDto } from '../list-items/dto/update-list-item.dto';
import { BatchItemsDto, SetPurchasedDto } from '../list-items/dto/batch-items.dto';
import { AtomicBatchService } from './atomic-batch.service';
import { RELIABLE_ROUTES, ShoppingOperation, ListBinding, MutationResult } from './operation-types';

export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class ReliableShoppingService {
  /** Phase D: deterministic precondition checked while holding the parent list write lock. */
  private async checkState(manager: EntityManager, listId: string, expected: string) {
    const list = await manager.getRepository(ShoppingList).findOneBy({ id: listId });
    if (!list) throw new NotFoundException('Resource not found');
    const items = await manager.getRepository(ListItem).findBy({ shoppingListId: listId });
    const text = (value: string | null | undefined) => value?.normalize('NFC').trim() || null;
    const state = [list.id, text(list.name), items.sort((a,b) => a.id.localeCompare(b.id)).map(i => [i.id, i.productId, i.quantity == null ? null : Number(i.quantity), text(i.unit), text(i.notes), i.isPurchased])];
    if (hash(JSON.stringify(state)) !== expected) throw new ConflictException('Shopping list changed; request a new confirmation');
  }

  constructor(private readonly db: DataSource, private readonly policy: AccessPolicy, private readonly batch: AtomicBatchService) {}

  key(value: unknown, required = true): string | undefined {
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(value)) throw new BadRequestException('A 16–128 character Idempotency-Key is required');
    return value;
  }

  private input(operation: ShoppingOperation, body: unknown): any {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid request');
    const classes = { 'list.create': CreateListDto, 'list.update': UpdateListDto, 'list.copy': CopyListDto, 'item.create': CreateListItemDto, 'item.update': UpdateListItemDto, 'item.batch': BatchItemsDto, 'item.purchase': SetPurchasedDto };
    const type = classes[operation];
    if (!type) {
      if (!['list.delete', 'item.delete', 'item.toggle'].includes(operation) || Object.keys(body).length) throw new BadRequestException('Invalid operation payload');
      return {};
    }
    const dto = plainToInstance(type, body);
    if (validateSync(dto as object, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) throw new BadRequestException('Invalid operation payload');
    // Normalize only values the operation actually uses; the hash and write use the same object.
    const normalize = (value: any, key = ''): any => {
      if (Array.isArray(value)) return value.map(v => normalize(v));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalize(v, k)]));
      if (typeof value === 'string') return key.endsWith('Id') ? value.toLowerCase() : value.trim().normalize('NFC');
      return value;
    };
    const result = normalize(dto);
    if (validateSync(plainToInstance(type, result) as object, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }).length) throw new BadRequestException('Invalid normalized operation payload');
    if ('name' in result && (typeof result.name !== 'string' || !result.name.length)) throw new BadRequestException('Name is required');
    return result;
  }

  private async principal(manager: EntityManager, user: Principal) {
    if (user.kind === 'integration') {
      if (!user.credentialId) throw new UnauthorizedException();
      const credential = await manager.getRepository(IntegrationCredential).findOne({ where: { id: user.credentialId, userId: user.id }, lock: { mode: 'pessimistic_read' } });
      if (!credential || credential.revokedAt || credential.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
      if (!credential.scopes.includes('shopping:write')) throw new ForbiddenException();
      const account = await manager.query('SELECT id FROM auth.users WHERE id=$1::uuid AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now())', [user.id]);
      if (account.length !== 1) throw new UnauthorizedException();
    }
    const profiles = await manager.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [user.id]);
    if (!profiles.length) throw new ForbiddenException('Account is not provisioned');
  }

  private async lockLists(manager: EntityManager, ids: string[]): Promise<ListBinding[]> {
    const unique = [...new Set(ids)].sort();
    if (!unique.length) return [];
    const lists = await manager.query('SELECT id,"userId" FROM shopping_lists WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [unique]);
    const owners = [...new Set(lists.map(l => l.userId).filter(Boolean))].sort();
    if (owners.length) await manager.query('SELECT id FROM profiles WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [owners]);
    return lists.map(l => ({ listId: l.id, ownerId: l.userId }));
  }

  private async lockProductReferences(manager: EntityManager, operation: ShoppingOperation, listId: string | undefined, input: any) {
    const productIds: string[] = input.productId ? [input.productId] : [];
    if (operation === 'list.copy') {
      const source = await manager.getRepository(ListItem).findBy({ shoppingListId: listId });
      productIds.push(...source.map(item => item.productId));
    }
    if (!productIds.length) return;
    const products = await manager.query('SELECT id,"userId" FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [[...new Set(productIds)].sort()]);
    const owners = [...new Set(products.map(product => product.userId).filter(Boolean))].sort();
    if (owners.length) await manager.query('SELECT id FROM profiles WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE', [owners]);
  }

  private async authorizeReceipt(manager: EntityManager, record: ShoppingOperationRecord, user: Principal) {
    if (user.kind === 'integration' && record.operation === 'item.toggle') throw new ForbiddenException();
    const scoped = this.policy.withManager(manager);
    for (const binding of record.listBindings) {
      const list = await manager.getRepository(ShoppingList).findOne({ where: { id: binding.listId }, lock: { mode: 'pessimistic_read' } });
      const owner = list?.userId ?? binding.ownerId;
      if (owner) await manager.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [owner]);
      if (list) await scoped.list(list.id, user.id);
      else if (!(await scoped.visibleUserIds(user.id)).includes(owner)) throw new NotFoundException('Resource not found');
    }
  }

  private async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async manager => {
        await manager.query("SET LOCAL lock_timeout='5s'");
        await manager.query("SET LOCAL statement_timeout='15s'");
        return work(manager);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Never retry here: a lost COMMIT acknowledgement may still mean success.
      throw new ServiceUnavailableException('Outcome uncertain; reconcile the operation before retrying');
    }
  }

  async execute(user: Principal, operation: ShoppingOperation, params: { listId?: string; itemId?: string }, body: unknown, keyHeader?: unknown, expectedState?: unknown): Promise<MutationResult> {
    const key = this.key(keyHeader, user.kind === 'integration' || operation === 'item.batch');
    if (expectedState !== undefined && (typeof expectedState !== 'string' || !/^[a-f0-9]{64}$/.test(expectedState) || !['list.update','item.update','item.batch','item.purchase','item.delete','list.delete'].includes(operation))) throw new BadRequestException('Invalid expected list state');
    const input = this.input(operation, body);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (operation !== 'list.create' && (typeof params.listId !== 'string' || !uuid.test(params.listId))) throw new BadRequestException('List identifier is required');
    if (['item.update', 'item.delete', 'item.toggle', 'item.purchase'].includes(operation) && (typeof params.itemId !== 'string' || !uuid.test(params.itemId))) throw new BadRequestException('Item identifier is required');
    const route = Object.entries(RELIABLE_ROUTES).find(([, value]) => value === operation);
    if (!route) throw new BadRequestException('Unsupported operation');
    const identifiers = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v?.toLowerCase()]));
    const digest = hash(canonicalJson({ operation, params: identifiers, input, ...(expectedState !== undefined ? { expectedState } : {}) }));
    const keyHash = key ? hash(key) : undefined;
    return this.transaction(async manager => {
      if (keyHash) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.id + ':' + keyHash]);
      await this.principal(manager, user);
      const repo = manager.getRepository(ShoppingOperationRecord);
      if (keyHash) {
        const previous = await repo.findOneBy({ userId: user.id, keyHash });
        if (previous) {
          await this.authorizeReceipt(manager, previous, user);
          if (previous.operation !== operation || previous.requestHash !== digest) throw new ConflictException('Idempotency-Key was already used for a different request');
          return { operationId: previous.id, replayed: true, httpStatus: previous.httpStatus, body: previous.responseBody };
        }
      }
      const ids = [identifiers.listId, operation === 'list.copy' ? input.targetListId : undefined].filter(Boolean);
      const bindings = await this.lockLists(manager, ids);
      await this.lockProductReferences(manager, operation, identifiers.listId, input);
      const scoped = this.policy.withManager(manager);
      const [controller, handler] = route[0].split('.');
      const request = { method: 'POST', params: controller === 'ListsController' ? { id: identifiers.listId } : identifiers, body: input };
      await scoped.authorize(controller, handler, request, user);
      if (expectedState !== undefined) await this.checkState(manager, identifiers.listId, expectedState as string);
      const lists = new ListsService(manager.getRepository(ShoppingList), manager.getRepository(ListItem), manager.getRepository(Profile));
      const items = new ListItemsService(manager.getRepository(ListItem));
      let result: any, httpStatus = 200;
      switch (operation) {
        case 'list.create':
          result = await lists.create(input, user.id); httpStatus = 201;
          bindings.push({ listId: result.id, ownerId: user.id }); break;
        case 'list.update': result = await lists.update(identifiers.listId, input); break;
        case 'list.delete': await lists.remove(identifiers.listId); httpStatus = 204; break;
        case 'list.copy': result = await lists.copyItemsToList(identifiers.listId, input.targetListId); httpStatus = 201; break;
        case 'item.create': result = await items.create(identifiers.listId, input); httpStatus = 201; break;
        case 'item.update': result = await items.update(identifiers.listId, identifiers.itemId, input); break;
        case 'item.purchase': result = await items.update(identifiers.listId, identifiers.itemId, input); break;
        case 'item.toggle': result = await items.togglePurchased(identifiers.listId, identifiers.itemId); break;
        case 'item.delete': await items.remove(identifiers.listId, identifiers.itemId); httpStatus = 204; break;
        case 'item.batch': result = await this.batch.add(manager, scoped, user.id, identifiers.listId, input); httpStatus = 201; break;
      }
      const responseBody = result === undefined ? null : JSON.parse(JSON.stringify(result));
      const operationId = keyHash ? randomUUID() : undefined;
      if (operationId) await repo.insert({ id: operationId, userId: user.id, keyHash, operation, requestHash: digest, httpStatus, responseBody, listBindings: bindings });
      return { operationId, replayed: false, httpStatus, body: responseBody };
    });
  }

  async respond(response: any, user: Principal, operation: ShoppingOperation, params: { listId?: string; itemId?: string }, body: unknown, key?: unknown, expectedState?: unknown) {
    const result = await this.execute(user, operation, params, body, key, expectedState);
    response.status(result.httpStatus);
    if (result.operationId) {
      response.setHeader('X-Operation-Id', result.operationId);
      response.setHeader('Idempotency-Replayed', String(result.replayed));
    }
    return result.httpStatus === 204 ? undefined : result.body;
  }

  async lookup(user: Principal, operationId?: string, keyHeader?: unknown) {
    const where = operationId ? { id: operationId, userId: user.id } : { keyHash: hash(this.key(keyHeader)), userId: user.id };
    return this.transaction(async manager => {
      await this.principal(manager, user);
      const record = await manager.getRepository(ShoppingOperationRecord).findOneBy(where);
      if (!record) throw new NotFoundException('Operation not found or not yet committed');
      await this.authorizeReceipt(manager, record, user);
      return { operationId: record.id, status: 'succeeded', httpStatus: record.httpStatus, result: record.responseBody };
    });
  }
}
