import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager, In, IsNull } from 'typeorm';
import { AccessPolicy } from '../auth/access-policy.service';
import { Product } from '../../database/entities/product.entity';
import { ListItem } from '../../database/entities/list-item.entity';
import { BatchItemsDto } from '../list-items/dto/batch-items.dto';

type Addition = { productId: string; quantity: number | null; unit: string | null; notes: string | null; isPurchased: boolean };
const text = (value: string | null | undefined): string | null => value == null || value.trim() === '' ? null : value.trim().normalize('NFC');

@Injectable()
export class AtomicBatchService {
  private cents(value: number | string | null | undefined): number {
    if (value == null) throw new ConflictException('Duplicate quantities must be explicit; update the item instead');
    const number = Number(value), cents = Math.round(number * 100);
    if (!Number.isFinite(number) || number < 0 || cents > 9999999999 || Math.abs(cents / 100 - number) > 0.000000001) throw new ConflictException('Quantity cannot be merged safely');
    return cents;
  }

  private combine(existing: Addition, incoming: Addition): Addition {
    if (text(existing.unit) !== text(incoming.unit) || text(existing.notes) !== text(incoming.notes) || existing.isPurchased !== incoming.isPurchased) {
      throw new ConflictException('Duplicate units, notes and purchase states must match; update the item instead');
    }
    const total = this.cents(existing.quantity) + this.cents(incoming.quantity);
    if (total > 9999999999) throw new ConflictException('Combined quantity exceeds the supported range');
    return { ...existing, quantity: total / 100 };
  }

  private async resolve(manager: EntityManager, policy: AccessPolicy, userId: string, item: BatchItemsDto['items'][number]): Promise<Product> {
    if ((item.productId != null ? 1 : 0) + (item.productName != null ? 1 : 0) !== 1) throw new BadRequestException('Specify exactly one productId or productName');
    let product: Product;
    if (item.productId) product = await policy.product(item.productId, userId);
    else {
      const owners = await policy.visibleUserIds(userId);
      const candidates = await manager.getRepository(Product).find({ where: [{ userId: In(owners) }, { userId: IsNull() }] });
      const visible: Product[] = [];
      for (const candidate of candidates.filter(p => p.name.trim().normalize('NFC') === item.productName)) {
        try { visible.push(await policy.product(candidate.id, userId)); }
        catch (error) { if (!(error instanceof NotFoundException)) throw error; }
      }
      if (!visible.length) throw new NotFoundException('Product not found');
      if (visible.length !== 1) throw new ConflictException('Product name is ambiguous; specify a productId');
      product = visible[0];
    }
    // Keep referenced product/owner changes out of this transaction's authorization window.
    await manager.getRepository(Product).findOne({ where: { id: product.id }, lock: { mode: 'pessimistic_read' } });
    if (product.userId) await manager.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [product.userId]);
    return policy.product(product.id, userId);
  }

  async add(manager: EntityManager, policy: AccessPolicy, userId: string, listId: string, body: BatchItemsDto) {
    await policy.list(listId, userId);
    const proposed = new Map<string, Addition>();
    // Resolve and validate the whole batch before writing any item. The caller also
    // holds the parent list lock, serializing other reliable item mutations.
    for (const input of body.items) {
      const product = await this.resolve(manager, policy, userId, input);
      const item: Addition = { productId: product.id, quantity: input.quantity ?? null, unit: text(input.unit), notes: text(input.notes), isPurchased: input.isPurchased ?? false };
      proposed.set(product.id, proposed.has(product.id) ? this.combine(proposed.get(product.id), item) : item);
    }
    const repo = manager.getRepository(ListItem);
    const existing = await repo.find({ where: { shoppingListId: listId, productId: In([...proposed.keys()]) }, order: { createdAt: 'ASC', id: 'ASC' } });
    const changes: ListItem[] = [];
    for (const [productId, addition] of [...proposed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const matches = existing.filter(item => item.productId === productId);
      if (matches.length > 1) throw new ConflictException('Multiple existing rows are ambiguous; update items explicitly');
      if (matches.length) {
        const merged = this.combine(matches[0], addition);
        changes.push(Object.assign(matches[0], merged));
      } else changes.push(repo.create({ ...addition, shoppingListId: listId }));
    }
    const items: ListItem[] = [];
    for (const change of changes) items.push(await repo.save(change));
    return { items };
  }
}
