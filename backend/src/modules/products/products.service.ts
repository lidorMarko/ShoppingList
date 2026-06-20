import { Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { SessionItem } from '../../database/entities/session-item.entity';
import { Profile } from '../../database/entities/profile.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const DEFAULT_PRODUCTS: { name: string; unit: string }[] = [
  { name: 'Milk', unit: 'L' },
  { name: 'Eggs', unit: 'pcs' },
  { name: 'Bread', unit: 'pcs' },
  { name: 'Butter', unit: 'g' },
  { name: 'Cheese', unit: 'g' },
  { name: 'Yogurt', unit: 'pcs' },
  { name: 'Chicken breast', unit: 'kg' },
  { name: 'Ground beef', unit: 'kg' },
  { name: 'Tomatoes', unit: 'kg' },
  { name: 'Cucumbers', unit: 'kg' },
  { name: 'Onions', unit: 'kg' },
  { name: 'Garlic', unit: 'pcs' },
  { name: 'Potatoes', unit: 'kg' },
  { name: 'Carrots', unit: 'kg' },
  { name: 'Apples', unit: 'kg' },
  { name: 'Bananas', unit: 'kg' },
  { name: 'Oranges', unit: 'kg' },
  { name: 'Rice', unit: 'kg' },
  { name: 'Pasta', unit: 'g' },
  { name: 'Olive oil', unit: 'ml' },
  { name: 'Salt', unit: 'g' },
  { name: 'Sugar', unit: 'g' },
  { name: 'Flour', unit: 'kg' },
  { name: 'Tuna', unit: 'pcs' },
  { name: 'Toilet paper', unit: 'pcs' },
];

@Injectable()
export class ProductsService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(SessionItem)
    private readonly itemRepo: Repository<SessionItem>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
  ) {}

  async onApplicationBootstrap() {
    const existing = await this.productRepo.findOne({ where: { userId: IsNull() } });
    if (!existing) {
      await this.productRepo.save(
        DEFAULT_PRODUCTS.map((p) => this.productRepo.create({ ...p, userId: null })),
      );
    }
  }

  private async visibleUserIds(userId: string): Promise<string[]> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    if (!profile?.familyId) return [userId];
    const members = await this.profileRepo.find({ where: { familyId: profile.familyId } });
    return members.map((m) => m.id);
  }

  async findAll(userId: string): Promise<(Product & { avgPrice: number | null })[]> {
    const userIds = await this.visibleUserIds(userId);
    const products = await this.productRepo.find({
      where: [{ userId: In(userIds) }, { userId: IsNull() }],
      relations: ['category'],
      order: { name: 'ASC' },
    });

    const avgRows: { productId: string; avgPrice: string }[] = await this.itemRepo.manager.query(
      `SELECT "productId", AVG(CAST(price AS NUMERIC)) AS "avgPrice"
       FROM session_items
       WHERE "isPurchased" = true AND price IS NOT NULL
       GROUP BY "productId"`,
    );

    const avgMap = new Map(avgRows.map((r) => [r.productId, parseFloat(r.avgPrice)]));
    return products.map((p) => Object.assign(p, { avgPrice: avgMap.get(p.id) ?? null }));
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async create(dto: CreateProductDto, userId: string): Promise<Product> {
    const product = this.productRepo.create({ ...dto, userId });
    return this.productRepo.save(product);
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    Object.assign(product, dto);
    return this.productRepo.save(product);
  }

  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);
    await this.productRepo.remove(product);
  }
}
