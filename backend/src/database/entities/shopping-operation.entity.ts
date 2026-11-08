import { Entity, PrimaryColumn, Column, Index, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Profile } from './profile.entity';
import { ListBinding, ShoppingOperation } from '../../modules/operations/operation-types';

@Entity('shopping_operations')
@Index('UQ_shopping_operations_user_key', ['userId', 'keyHash'], { unique: true })
@Index('IDX_shopping_operations_user_created', ['userId', 'createdAt'])
export class ShoppingOperationRecord {
  @PrimaryColumn('uuid') id: string;
  @Column() userId: string;
  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' }) user: Profile;
  @Column({ type: 'char', length: 64 }) keyHash: string;
  @Column({ type: 'varchar' }) operation: ShoppingOperation;
  @Column({ type: 'char', length: 64 }) requestHash: string;
  @Column() httpStatus: number;
  @Column({ type: 'jsonb', nullable: true }) responseBody: unknown;
  @Column({ type: 'jsonb' }) listBindings: ListBinding[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
