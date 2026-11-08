import { Controller, Get, Post, Put, Delete, Param, Body, Headers, Res } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Principal } from '../auth/access-policy.service';
import { ReliableShoppingService } from '../operations/reliable-shopping.service';
import { ListsService } from './lists.service';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { CopyListDto } from './dto/copy-list.dto';

@Controller('lists')
export class ListsController {
  constructor(private readonly listsService: ListsService, private readonly reliable: ReliableShoppingService) {}
  @Get()
  findAll(@CurrentUser() user: Principal) { return this.listsService.findAll(user.id); }
  @Get(':id')
  findOne(@Param('id') id: string) { return this.listsService.findOne(id); }
  @Post()
  create(@Body() body: CreateListDto, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'list.create', {}, body, key);
  }
  @Put(':id')
  update(@Param('id') listId: string, @Body() body: UpdateListDto, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'list.update', { listId }, body, key);
  }
  @Delete(':id')
  remove(@Param('id') listId: string, @Body() body: unknown, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'list.delete', { listId }, body ?? {}, key);
  }
  @Post(':id/copy-items')
  copyItems(@Param('id') listId: string, @Body() body: CopyListDto, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'list.copy', { listId }, body, key);
  }
}
