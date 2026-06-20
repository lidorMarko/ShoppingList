import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Family } from '../../database/entities/family.entity';
import { Profile } from '../../database/entities/profile.entity';

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

@Injectable()
export class FamiliesService {
  constructor(
    @InjectRepository(Family)
    private readonly familyRepo: Repository<Family>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
  ) {}

  async create(name: string, userId: string): Promise<Profile> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.familyId) throw new BadRequestException('You are already in a family. Leave first.');

    let inviteCode: string;
    let exists = true;
    do {
      inviteCode = generateInviteCode();
      exists = !!(await this.familyRepo.findOne({ where: { inviteCode } }));
    } while (exists);

    const family = await this.familyRepo.save(this.familyRepo.create({ name, inviteCode }));

    profile.familyId = family.id;
    profile.familyRole = 'admin';
    await this.profileRepo.save(profile);

    return this.profileRepo.findOne({ where: { id: userId }, relations: ['family', 'family.members'] });
  }

  async join(inviteCode: string, userId: string): Promise<Profile> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (profile.familyId) throw new BadRequestException('You are already in a family. Leave first.');

    const family = await this.familyRepo.findOne({ where: { inviteCode: inviteCode.toUpperCase() } });
    if (!family) throw new NotFoundException('Invalid invite code');

    profile.familyId = family.id;
    profile.familyRole = 'member';
    await this.profileRepo.save(profile);

    return this.profileRepo.findOne({ where: { id: userId }, relations: ['family', 'family.members'] });
  }

  async leave(userId: string): Promise<Profile> {
    const profile = await this.profileRepo.findOne({
      where: { id: userId },
      relations: ['family', 'family.members'],
    });
    if (!profile) throw new NotFoundException('Profile not found');
    if (!profile.familyId) throw new BadRequestException('You are not in a family');

    // If admin and last member, delete the family
    const family = profile.family;
    const isLastMember = family?.members?.length === 1;
    profile.familyId = null;
    profile.familyRole = 'member';
    await this.profileRepo.save(profile);

    if (isLastMember) {
      await this.familyRepo.remove(family);
    }

    return this.profileRepo.findOne({ where: { id: userId }, relations: ['family'] });
  }

  async getFamilyMembers(userId: string): Promise<Profile[]> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    if (!profile?.familyId) return [];
    return this.profileRepo.find({ where: { familyId: profile.familyId } });
  }
}
