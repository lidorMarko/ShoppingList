import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListsService } from './lists.service';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { CopyListDto } from './dto/copy-list.dto';

@Controller('lists')
@UseGuards(SupabaseAuthGuard)
export class ListsController {
  constructor(private readonly listsService: ListsService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.listsService.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateListDto, @CurrentUser() user: { id: string }) {
    return this.listsService.create(dto, user.id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateListDto) {
    return this.listsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.listsService.remove(id);
  }

  @Post(':id/copy-items')
  copyItems(@Param('id') sourceId: string, @Body() dto: CopyListDto) {
    return this.listsService.copyItemsToList(sourceId, dto.targetListId);
  }
}
