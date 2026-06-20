import { Controller, Get, Post, Body, Query, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('validate-invite')
  validateInvite(@Body('code') code: string) {
    if (!this.authService.validateInviteCode(code)) {
      throw new UnauthorizedException('Invalid invite code');
    }
    return { valid: true };
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  async me(
    @CurrentUser() user: { id: string; email: string },
    @Query('inviteCode') inviteCode?: string,
  ) {
    return this.authService.upsertProfile(user.id, user.email, inviteCode);
  }
}
