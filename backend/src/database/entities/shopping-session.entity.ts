import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { ShoppingList } from './shopping-list.entity';
import { SessionItem } from './session-item.entity';

export type SessionStatus = 'active' | 'completed';

@Entity('shopping_sessions')
export class ShoppingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  shoppingListId: string;

  @Column({ default: 'active' })
  status: SessionStatus;

  @Column({ nullable: true })
  completedAt: Date;

  @Column({ nullable: true })
  receiptUrl: string;

  @Column({ type: 'jsonb', nullable: true })
  receiptAnalysis: Record<string, unknown>;

  @CreateDateColumn()
  startedAt: Date;

  @ManyToOne(() => ShoppingList, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'shoppingListId' })
  shoppingList: ShoppingList;

  @OneToMany(() => SessionItem, (item) => item.session, { cascade: true })
  items: SessionItem[];
}
