import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { SessionItem } from '../../database/entities/session-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { HiddenProduct } from '../../database/entities/hidden-product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(SessionItem)
    private readonly itemRepo: Repository<SessionItem>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    @InjectRepository(HiddenProduct)
    private readonly hiddenRepo: Repository<HiddenProduct>,
    private readonly config: ConfigService,
  ) {}

  private async visibleUserIds(userId: string): Promise<string[]> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    if (!profile?.familyId) return [userId];
    const members = await this.profileRepo.find({ where: { familyId: profile.familyId } });
    return members.map((m) => m.id);
  }

  isAdmin(email: string): boolean {
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    return !!adminEmail && email === adminEmail;
  }

  async findAll(userId: string): Promise<(Product & { avgPrice: number | null })[]> {
    const userIds = await this.visibleUserIds(userId);

    const hidden = await this.hiddenRepo.find({
      where: { userId: In(userIds) },
      select: ['productId'],
    });
    const hiddenIds = hidden.map((h) => h.productId);

    const baseConditions = [{ userId: In(userIds) }, { userId: IsNull() }];
    const whereConditions = hiddenIds.length > 0
      ? baseConditions.map((c) => ({ ...c, id: Not(In(hiddenIds)) }))
      : baseConditions;

    const products = await this.productRepo.find({
      where: whereConditions,
      relations: ['category'],
      order: { name: 'ASC' },
    });

    const avgRows: { productId: string; avgPrice: string }[] = await this.itemRepo.manager.query(
      `SELECT "productId", AVG(CAST(price AS NUMERIC)) AS "avgPrice"
       FROM session_items
       JOIN shopping_sessions s ON s.id = session_items."sessionId"
       JOIN shopping_lists l ON l.id = s."shoppingListId"
       WHERE session_items."isPurchased" = true AND price IS NOT NULL AND l."userId" = ANY($1::text[])
       GROUP BY "productId"`, [userIds],
    );

    const avgMap = new Map(avgRows.map((r) => [r.productId, parseFloat(r.avgPrice)]));
    return products.map((p) => Object.assign(p, { avgPrice: avgMap.get(p.id) ?? null }));
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id }, relations: ['category'] });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async create(dto: CreateProductDto, userId: string, userEmail: string): Promise<Product> {
    const { isGlobal, ...rest } = dto;
    const effectiveUserId = isGlobal && this.isAdmin(userEmail) ? null : userId;
    const product = this.productRepo.create({ ...rest, userId: effectiveUserId });
    return this.productRepo.save(product);
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    Object.assign(product, dto);
    return this.productRepo.save(product);
  }

  async remove(id: string, userId: string): Promise<void> {
    const product = await this.findOne(id);

    if (product.userId === userId) {
      await this.productRepo.remove(product);
    } else {
      const existing = await this.hiddenRepo.findOne({ where: { userId, productId: id } });
      if (!existing) {
        await this.hiddenRepo.upsert({ userId, productId: id }, ['userId', 'productId']);
      }
    }
  }
}
