import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Family } from '../../database/entities/family.entity';
import { Profile } from '../../database/entities/profile.entity';
import { FamiliesService } from './families.service';
import { FamiliesController } from './families.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Family, Profile])],
  providers: [FamiliesService],
  controllers: [FamiliesController],
})
export class FamiliesModule {}
