import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Headers, Res } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { Principal } from '../auth/access-policy.service';
import { ReliableShoppingService } from '../operations/reliable-shopping.service';
import { ListItemsService } from './list-items.service';
import { CreateListItemDto } from './dto/create-list-item.dto';
import { UpdateListItemDto } from './dto/update-list-item.dto';
import { BatchItemsDto, SetPurchasedDto } from './dto/batch-items.dto';

@Controller('lists/:listId/items')
export class ListItemsController {
  constructor(private readonly listItemsService: ListItemsService, private readonly reliable: ReliableShoppingService) {}
  @Get()
  findAll(@Param('listId') listId: string) { return this.listItemsService.findByList(listId); }

  @Post()
  create(@Param('listId') listId: string, @Body() body: CreateListItemDto, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'item.create', { listId }, body, key);
  }
  @Post('batch')
  batch(@Param('listId') listId: string, @Body() body: BatchItemsDto, @CurrentUser() user: Principal, @Headers('if-match') expectedState: string, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'item.batch', { listId }, body, key, expectedState);
  }
  @Put(':itemId')
  update(@Param('listId') listId: string, @Param('itemId') itemId: string, @Body() body: UpdateListItemDto, @CurrentUser() user: Principal, @Headers('if-match') expectedState: string, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'item.update', { listId, itemId }, body, key, expectedState);
  }
  @Patch(':itemId/purchased')
  setPurchased(@Param('listId') listId: string, @Param('itemId') itemId: string, @Body() body: SetPurchasedDto, @CurrentUser() user: Principal, @Headers('if-match') expectedState: string, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'item.purchase', { listId, itemId }, body, key, expectedState);
  }
  @Patch(':itemId/toggle')
  toggle(@Param('listId') listId: string, @Param('itemId') itemId: string, @Body() body: unknown, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'item.toggle', { listId, itemId }, body ?? {}, key);
  }
  @Delete(':itemId')
  remove(@Param('listId') listId: string, @Param('itemId') itemId: string, @Body() body: unknown, @CurrentUser() user: Principal, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: any) {
    return this.reliable.respond(response, user, 'item.delete', { listId, itemId }, body ?? {}, key);
  }
}
