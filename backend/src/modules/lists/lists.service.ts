import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ShoppingList } from '../../database/entities/shopping-list.entity';
import { ListItem } from '../../database/entities/list-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';

@Injectable()
export class ListsService {
  constructor(
    @InjectRepository(ShoppingList)
    private readonly listRepo: Repository<ShoppingList>,
    @InjectRepository(ListItem)
    private readonly itemRepo: Repository<ListItem>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
  ) {}

  private async visibleUserIds(userId: string): Promise<string[]> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    if (!profile?.familyId) return [userId];
    const members = await this.profileRepo.find({ where: { familyId: profile.familyId } });
    return members.map((m) => m.id);
  }

  async findAll(userId: string): Promise<ShoppingList[]> {
    const userIds = await this.visibleUserIds(userId);
    return this.listRepo.find({
      where: { userId: In(userIds) },
      relations: ['items', 'items.product', 'items.product.category'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ShoppingList> {
    const list = await this.listRepo.findOne({
      where: { id },
      relations: ['items', 'items.product', 'items.product.category'],
    });
    if (!list) throw new NotFoundException(`Shopping list ${id} not found`);
    return list;
  }

  async create(dto: CreateListDto, userId: string): Promise<ShoppingList> {
    const list = this.listRepo.create({ ...dto, userId });
    return this.listRepo.save(list);
  }

  async update(id: string, dto: UpdateListDto): Promise<ShoppingList> {
    const list = await this.findOne(id);
    Object.assign(list, dto);
    return this.listRepo.save(list);
  }

  async remove(id: string): Promise<void> {
    const list = await this.findOne(id);
    await this.listRepo.remove(list);
  }

  async copyItemsToList(sourceId: string, targetId: string): Promise<ShoppingList> {
    const source = await this.findOne(sourceId);
    const target = await this.findOne(targetId);

    const existingProductIds = new Set(target.items.map((i) => i.productId));
    const newItems = source.items
      .filter((item) => !existingProductIds.has(item.productId))
      .map((item) =>
        this.itemRepo.create({
          shoppingListId: target.id,
          productId: item.productId,
          quantity: item.quantity,
          unit: item.unit,
          notes: item.notes,
          isPurchased: false,
        }),
      );

    if (newItems.length > 0) await this.itemRepo.save(newItems);
    return this.findOne(targetId);
  }
}
