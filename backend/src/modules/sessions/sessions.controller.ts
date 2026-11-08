import {
  Controller,
  Res,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { AddSessionItemDto, UpdateSessionItemDto } from './dto/update-session-item.dto';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.sessionsService.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sessionsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.sessionsService.complete(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.sessionsService.remove(id);
  }

  @Get(':id/receipt/file')
  async downloadReceipt(@Param('id') id: string, @Res() response: any) {
    const file = await this.sessionsService.downloadReceipt(id);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    response.send(file.buffer);
  }

  // Receipt
  @Post(':id/analyze-receipt')
  analyzeReceipt(@Param('id') id: string) {
    return this.sessionsService.analyzeReceipt(id);
  }

  @Post(':id/receipt')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only image files and PDFs are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadReceipt(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.sessionsService.uploadReceipt(id, file);
  }

  // Session items
  @Post(':id/items')
  addItem(@Param('id') sessionId: string, @Body() dto: AddSessionItemDto) {
    return this.sessionsService.addItem(sessionId, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') sessionId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSessionItemDto,
  ) {
    return this.sessionsService.updateItem(sessionId, itemId, dto);
  }

  @Patch(':id/items/:itemId/toggle')
  toggleItem(@Param('id') sessionId: string, @Param('itemId') itemId: string) {
    return this.sessionsService.toggleItem(sessionId, itemId);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(@Param('id') sessionId: string, @Param('itemId') itemId: string) {
    return this.sessionsService.removeItem(sessionId, itemId);
  }
}
