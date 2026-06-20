import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadsService {
  private supabase;

  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(
      config.get<string>('SUPABASE_URL'),
      config.get<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  async uploadProductImage(file: Express.Multer.File): Promise<string> {
    const ext = file.originalname.split('.').pop();
    const filename = `${uuid()}.${ext}`;

    const { error } = await this.supabase.storage
      .from('product-images')
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) throw new InternalServerErrorException(error.message);

    const { data } = this.supabase.storage
      .from('product-images')
      .getPublicUrl(filename);

    return data.publicUrl;
  }
}
