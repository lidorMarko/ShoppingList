import { Profile } from './profile.entity';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';

@Entity('integration_credentials')
@Index('IDX_eden_credentials_user', ['userId'])
export class IntegrationCredential {
  @PrimaryColumn('uuid') id: string;
  @Column() userId: string;
  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' }) profile: Profile;
  @Column({ select: false }) tokenHash: string;
  @Column('text', { array: true }) scopes: string[];
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
