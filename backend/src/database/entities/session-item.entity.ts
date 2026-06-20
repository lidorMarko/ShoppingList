import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ShoppingSession } from './shopping-session.entity';
import { Product } from './product.entity';

@Entity('session_items')
export class SessionItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

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

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => ShoppingSession, (session) => session.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: ShoppingSession;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;
}
