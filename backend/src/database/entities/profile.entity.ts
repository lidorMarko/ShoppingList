import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Family } from './family.entity';

@Entity('profiles')
export class Profile {
  @PrimaryColumn()
  id: string; // matches Supabase auth.users.id

  @Column()
  email: string;

  @Column({ nullable: true })
  displayName: string;

  @Column({ nullable: true })
  familyId: string;

  @Column({ default: 'member' })
  familyRole: string; // 'admin' | 'member'

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Family, (family) => family.members, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'familyId' })
  family: Family;
}
