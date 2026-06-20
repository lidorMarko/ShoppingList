import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ShoppingList } from './shopping-list.entity';
import { Product } from './product.entity';

@Entity('list_items')
export class ListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shoppingListId: string;

  @Column()
  productId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  quantity: number;

  @Column({ nullable: true })
  unit: string;

  @Column({ nullable: true })
  notes: string;

  @Column({ default: false })
  isPurchased: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => ShoppingList, (list) => list.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shoppingListId' })
  shoppingList: ShoppingList;

  @ManyToOne(() => Product, (product) => product.listItems, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'productId' })
  product: Product;
}
