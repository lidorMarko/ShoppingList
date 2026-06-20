import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Profile } from '../../database/entities/profile.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    private readonly config: ConfigService,
  ) {}

  validateInviteCode(code: string): boolean {
    const expected = this.config.get<string>('APP_INVITE_CODE');
    return !!expected && code === expected;
  }

  async upsertProfile(id: string, email: string, inviteCode?: string): Promise<Profile> {
    let profile = await this.profileRepo.findOne({
      where: { id },
      relations: ['family', 'family.members'],
    });

    if (!profile) {
      if (!inviteCode || !this.validateInviteCode(inviteCode)) {
        throw new ForbiddenException('A valid invite code is required to create an account.');
      }
      profile = this.profileRepo.create({ id, email, displayName: email.split('@')[0] });
      await this.profileRepo.save(profile);
      profile = await this.profileRepo.findOne({ where: { id }, relations: ['family', 'family.members'] });
    }

    return profile!;
  }

  async getProfile(id: string): Promise<Profile | null> {
    return this.profileRepo.findOne({
      where: { id },
      relations: ['family', 'family.members'],
    });
  }
}
