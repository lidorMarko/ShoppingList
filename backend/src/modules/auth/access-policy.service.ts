import { RELIABLE_ROUTES } from '../operations/operation-types';
import { UploadsService } from '../uploads/uploads.service';
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Profile } from '../../database/entities/profile.entity';
import { ShoppingList } from '../../database/entities/shopping-list.entity';
import { ListItem } from '../../database/entities/list-item.entity';
import { Product } from '../../database/entities/product.entity';
import { HiddenProduct } from '../../database/entities/hidden-product.entity';
import { ShoppingSession } from '../../database/entities/shopping-session.entity';
import { SessionItem } from '../../database/entities/session-item.entity';

export interface Principal { id: string; email: string; kind: 'web' | 'integration'; scopes: string[]; emailVerified: boolean; credentialId?: string }

@Injectable()
export class AccessPolicy {
  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly uploads: UploadsService) {}

  withManager(manager: EntityManager): AccessPolicy {
    return new AccessPolicy(manager as unknown as DataSource, this.config, this.uploads);
  }

  async visibleUserIds(userId: string): Promise<string[]> {
    const profile = await this.db.getRepository(Profile).findOneBy({ id: userId });
    if (!profile) throw new ForbiddenException('Account is not provisioned');
    if (!profile.familyId) return [userId];
    return (await this.db.getRepository(Profile).findBy({ familyId: profile.familyId })).map(p => p.id);
  }

  requireAdmin(user: Principal) {
    const admin = this.config.get<string>('ADMIN_EMAIL');
    if (user.kind !== 'web' || !user.emailVerified || !admin || user.email !== admin) throw new ForbiddenException();
  }

  async list(id: string, userId: string) {
    const ids = await this.visibleUserIds(userId);
    const list = await this.db.getRepository(ShoppingList).findOneBy({ id, userId: In(ids) });
    if (!list) throw new NotFoundException('Resource not found');
    return list;
  }

  async product(id: string, userId: string, allowHidden = false) {
    const ids = await this.visibleUserIds(userId);
    const product = await this.db.getRepository(Product).findOne({ where: [{ id, userId: In(ids) }, { id, userId: IsNull() }] });
    if (!product) throw new NotFoundException('Resource not found');
    if (!allowHidden && await this.db.getRepository(HiddenProduct).existsBy({ productId: id, userId: In(ids) })) {
      throw new NotFoundException('Resource not found');
    }
    return product;
  }

  async productImage(id: string, userId: string) {
    const product = await this.product(id, userId, true);
    const owners = await this.visibleUserIds(userId);
    if (!await this.db.getRepository(HiddenProduct).existsBy({ productId: id, userId: In(owners) })) return product;
    // Hiding removes catalog discovery, but images already used by authorized lists/sessions remain usable.
    const lists = await this.db.getRepository(ShoppingList).find({ where: { userId: In(owners) }, select: ['id'] });
    const listIds = lists.map(list => list.id);
    if (listIds.length && await this.db.getRepository(ListItem).existsBy({ productId: id, shoppingListId: In(listIds) })) return product;
    const sessions = listIds.length ? await this.db.getRepository(ShoppingSession).find({ where: { shoppingListId: In(listIds) }, select: ['id'] }) : [];
    if (sessions.length && await this.db.getRepository(SessionItem).existsBy({ productId: id, sessionId: In(sessions.map(session => session.id)) })) return product;
    throw new NotFoundException('Resource not found');
  }

  async session(id: string, userId: string) {
    const session = await this.db.getRepository(ShoppingSession).findOneBy({ id });
    if (!session || !session.shoppingListId) throw new NotFoundException('Resource not found');
    await this.list(session.shoppingListId, userId);
    return session;
  }

  // A closed route manifest: new handlers are denied until their policy is reviewed.
  async authorize(controller: string, handler: string, req: any, user: Principal, guardPhase = false) {
    const routes: Record<string, string[]> = {
      OperationsController: ['findOne', 'findByKey'],
      AuthController: ['me'], FamiliesController: ['create', 'join', 'leave'],
      ListsController: ['findAll', 'findOne', 'create', 'update', 'remove', 'copyItems'],
      ListItemsController: ['findAll', 'create', 'update', 'toggle', 'remove', 'batch', 'setPurchased'],
      ProductsController: ['findAll', 'findOne', 'image', 'isAdmin', 'create', 'update', 'remove'],
      CategoriesController: ['findAll', 'findOne', 'create', 'update', 'remove'],
      UploadsController: ['uploadProductImage', 'downloadPreview'],
      SessionsController: ['findAll', 'findOne', 'create', 'complete', 'remove', 'analyzeReceipt', 'uploadReceipt', 'downloadReceipt', 'addItem', 'updateItem', 'toggleItem', 'removeItem'],
      IntegrationCredentialsController: ['list', 'create', 'revoke'],
    };
    if (!routes[controller]?.includes(handler)) throw new ForbiddenException();
    if (user.kind === 'integration') {
      const reads: Record<string, string[]> = {
        ListsController: ['findAll', 'findOne'], ListItemsController: ['findAll'],
        ProductsController: ['findAll', 'findOne'], CategoriesController: ['findAll', 'findOne'],
      };
      const mutation = RELIABLE_ROUTES[`${controller}.${handler}`];
      if (mutation || controller === 'OperationsController') {
        if (!user.scopes.includes('shopping:write') || mutation === 'item.toggle') throw new ForbiddenException();
      } else if (req.method !== 'GET' || !reads[controller]?.includes(handler) || !user.scopes.includes('shopping:read')) throw new ForbiddenException();
    }
    if (controller === 'AuthController') return;
    await this.visibleUserIds(user.id);
    // Keyed mutations may replay a deleted target; the transaction service authorizes
    // current resources or its own deletion receipt before executing/returning anything.
    if (guardPhase && typeof req.headers?.['idempotency-key'] === 'string' && RELIABLE_ROUTES[`${controller}.${handler}`]) return;
    const p = req.params || {}, body = req.body || {};
    if (controller === 'ListsController') {
      if (p.id) await this.list(p.id, user.id);
      if (handler === 'copyItems') {
        await this.list(body.targetListId, user.id);
        const items = await this.db.getRepository(ListItem).findBy({ shoppingListId: p.id });
        for (const item of items) await this.product(item.productId, user.id);
      }
    }
    if (controller === 'ListItemsController') {
      await this.list(p.listId, user.id);
      if (p.itemId && !await this.db.getRepository(ListItem).existsBy({ id: p.itemId, shoppingListId: p.listId })) throw new NotFoundException('Resource not found');
      if (body.productId) await this.product(body.productId, user.id);
    }
    if (controller === 'UploadsController' && handler === 'downloadPreview') {
      const { bucket, key } = this.uploads.imageLocation(req.query?.reference);
      if (bucket !== 'product-images-private' || !(await this.visibleUserIds(user.id)).includes(key.split('/')[0])) throw new NotFoundException('Resource not found');
    }
    if (controller === 'ProductsController') {
      if (body.imageUrl) {
        const { bucket, key } = this.uploads.imageLocation(body.imageUrl);
        const existing = p.id ? await this.product(p.id, user.id) : null;
        if (body.imageUrl !== existing?.imageUrl && (bucket !== 'product-images-private' || !(await this.visibleUserIds(user.id)).includes(key.split('/')[0]))) throw new NotFoundException('Resource not found');
      }
      if (p.id) {
        const product = handler === 'image' ? await this.productImage(p.id, user.id) : await this.product(p.id, user.id, handler === 'remove');
        if (handler === 'update' && product.userId === null) this.requireAdmin(user);
        // Shared private products may be edited by current family members.
      }
      if (body.isGlobal) this.requireAdmin(user);
    }
    if (controller === 'CategoriesController' && ['create', 'update', 'remove'].includes(handler)) this.requireAdmin(user);
    if (controller === 'SessionsController') {
      if (p.id) await this.session(p.id, user.id);
      if (handler === 'create') {
        await this.list(body.shoppingListId, user.id);
        const items = await this.db.getRepository(ListItem).findBy({ shoppingListId: body.shoppingListId });
        for (const item of items) await this.product(item.productId, user.id, true);
      }
      if (p.itemId && !await this.db.getRepository(SessionItem).existsBy({ id: p.itemId, sessionId: p.id })) throw new NotFoundException('Resource not found');
      if (body.productId) await this.product(body.productId, user.id);
    }
  }
}
