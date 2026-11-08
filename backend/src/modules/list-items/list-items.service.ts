import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListItem } from '../../database/entities/list-item.entity';
import { CreateListItemDto } from './dto/create-list-item.dto';
import { UpdateListItemDto } from './dto/update-list-item.dto';

@Injectable()
export class ListItemsService {
  constructor(
    @InjectRepository(ListItem)
    private readonly itemRepo: Repository<ListItem>,
  ) {}

  async findByList(listId: string): Promise<ListItem[]> {
    return this.itemRepo.find({
      where: { shoppingListId: listId },
      relations: ['product', 'product.category'],
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(listId: string, id: string): Promise<ListItem> {
    const item = await this.itemRepo.findOne({
      where: { id, shoppingListId: listId },
      relations: ['product', 'product.category'],
    });
    if (!item) throw new NotFoundException(`List item ${id} not found`);
    return item;
  }

  async create(listId: string, dto: CreateListItemDto): Promise<ListItem> {
    const item = this.itemRepo.create({ ...dto, shoppingListId: listId });
    return this.itemRepo.save(item);
  }

  async update(listId: string, id: string, dto: UpdateListItemDto): Promise<ListItem> {
    const item = await this.findOne(listId, id);
    Object.assign(item, dto);
    return this.itemRepo.save(item);
  }

  async togglePurchased(listId: string, id: string): Promise<ListItem> {
    const item = await this.findOne(listId, id);
    item.isPurchased = !item.isPurchased;
    return this.itemRepo.save(item);
  }

  async remove(listId: string, id: string): Promise<void> {
    const item = await this.findOne(listId, id);
    await this.itemRepo.remove(item);
  }
}
