import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../../database/entities/profile.entity';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Profile]),
  ],
  providers: [SupabaseAuthGuard, AuthService, ConfigService],
  controllers: [AuthController],
  exports: [AuthService, SupabaseAuthGuard],
})
export class AuthModule {}
