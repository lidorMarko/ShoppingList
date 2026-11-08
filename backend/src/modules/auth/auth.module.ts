import { ReliableShoppingService } from '../operations/reliable-shopping.service';
import { AtomicBatchService } from '../operations/atomic-batch.service';
import { OperationsController } from '../operations/operations.controller';
import { UploadsModule } from '../uploads/uploads.module';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from '../../database/entities/profile.entity';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

import { PrivacyInterceptor } from './privacy.interceptor';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessPolicy } from './access-policy.service';
import { IntegrationCredentialsService } from './integration-credentials.service';
import { IntegrationCredentialsController } from './integration-credentials.controller';

@Global()
@Module({
  imports: [
    ConfigModule,
    UploadsModule,
    TypeOrmModule.forFeature([Profile]),
  ],
  providers: [ReliableShoppingService, AtomicBatchService, AccessPolicy, IntegrationCredentialsService, AuthService, ConfigService, { provide: APP_GUARD, useClass: SupabaseAuthGuard }, { provide: APP_INTERCEPTOR, useClass: PrivacyInterceptor }],
  controllers: [OperationsController, AuthController, IntegrationCredentialsController],
  exports: [AuthService, AccessPolicy, ReliableShoppingService],
})
export class AuthModule {}
