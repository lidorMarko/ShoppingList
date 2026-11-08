import { CurrentUser } from '../auth/current-user.decorator';
import {
  Controller,
  Get, Query, Res,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Get('product-image')
  async downloadPreview(@Query('reference') reference: string, @Res() response: any) {
    const file = await this.uploadsService.downloadImage(reference);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.contentType).send(file.buffer);
  }

  @Post('product-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadProductImage(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: { id: string }) {
    if (!file) throw new BadRequestException('No file provided');
    const url = await this.uploadsService.uploadProductImage(file, user.id);
    return { url };
  }
}
