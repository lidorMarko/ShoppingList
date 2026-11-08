import { Principal } from '../auth/access-policy.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  Controller,
  Res,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService, private readonly uploads: UploadsService) {}

  @Get()
  findAll(@Query('search') search: string | undefined, @CurrentUser() user: { id: string }) {
    return this.productsService.findAll(user.id);
  }

  @Get('me/is-admin')
  isAdmin(@CurrentUser() user: Principal) {
    return { isAdmin: user.emailVerified && this.productsService.isAdmin(user.email) };
  }

  @Get(':id/image')
  async image(@Param('id') id: string, @Res() response: any) {
    const product = await this.productsService.findOne(id);
    const file = await this.uploads.downloadImage(product.imageUrl);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type(file.contentType).send(file.buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: { id: string; email: string }) {
    return this.productsService.create(dto, user.id, user.email);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.productsService.remove(id, user.id);
  }
}
