import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Profile } from './profile.entity';

@Entity('families')
export class Family {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  inviteCode: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Profile, (profile) => profile.family)
  members: Profile[];
}
