import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FamiliesService } from './families.service';

@Controller('families')
@UseGuards(SupabaseAuthGuard)
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Post()
  create(@Body('name') name: string, @CurrentUser() user: { id: string }) {
    return this.familiesService.create(name, user.id);
  }

  @Post('join')
  join(@Body('inviteCode') inviteCode: string, @CurrentUser() user: { id: string }) {
    return this.familiesService.join(inviteCode, user.id);
  }

  @Delete('leave')
  leave(@CurrentUser() user: { id: string }) {
    return this.familiesService.leave(user.id);
  }
}
