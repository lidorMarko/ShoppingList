import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ListItemsService } from './list-items.service';
import { CreateListItemDto } from './dto/create-list-item.dto';
import { UpdateListItemDto } from './dto/update-list-item.dto';

@Controller('lists/:listId/items')
export class ListItemsController {
  constructor(private readonly listItemsService: ListItemsService) {}

  @Get()
  findAll(@Param('listId') listId: string) {
    return this.listItemsService.findByList(listId);
  }

  @Post()
  create(@Param('listId') listId: string, @Body() dto: CreateListItemDto) {
    return this.listItemsService.create(listId, dto);
  }

  @Put(':itemId')
  update(@Param('itemId') itemId: string, @Body() dto: UpdateListItemDto) {
    return this.listItemsService.update(itemId, dto);
  }

  @Patch(':itemId/toggle')
  toggle(@Param('itemId') itemId: string) {
    return this.listItemsService.togglePurchased(itemId);
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('itemId') itemId: string) {
    return this.listItemsService.remove(itemId);
  }
}
