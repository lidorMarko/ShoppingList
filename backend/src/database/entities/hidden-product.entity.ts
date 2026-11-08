import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('hidden_products')
@Index('UQ_eden_hidden_user_product', ['userId', 'productId'], { unique: true })
export class HiddenProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  productId: string;

  @CreateDateColumn()
  createdAt: Date;
}
