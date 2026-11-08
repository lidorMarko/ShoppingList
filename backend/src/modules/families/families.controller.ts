import { Controller, Post, Delete, Body } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { FamiliesService } from './families.service';

@Controller('families')
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
