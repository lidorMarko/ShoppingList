import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

@Injectable()
export class UploadsService {
  private supabase;
  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(config.get<string>('SUPABASE_URL'), config.get<string>('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  }
  imageLocation(reference: string) {
    let url: URL;
    try { url = new URL(reference); } catch { throw new BadRequestException('Invalid image reference'); }
    const origin = new URL(this.config.get<string>('SUPABASE_URL')).origin;
    const match = /^\/storage\/v1\/object\/public\/(product-images(?:-private)?)\/(.+)$/.exec(url.pathname);
    if (url.origin !== origin || !match || url.username || url.password || url.search || url.hash) throw new BadRequestException('Invalid image reference');
    let key: string;
    try { key = decodeURIComponent(match[2]); } catch { throw new BadRequestException('Invalid image reference'); }
    if (!/^(?:[0-9a-f-]{36}\/)?[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif)$/i.test(key)) throw new BadRequestException('Invalid image reference');
    return { bucket: match[1], key };
  }
  private async requirePrivate(bucket: string) {
    const { data, error } = await this.supabase.storage.getBucket(bucket);
    if (error || !data || data.public !== false) throw new InternalServerErrorException('Private product image storage must be configured');
  }
  async uploadProductImage(file: Express.Multer.File, userId: string): Promise<string> {
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    const ext = extensions[file.mimetype];
    if (!ext) throw new BadRequestException('Unsupported image type');
    await this.requirePrivate('product-images-private');
    const filename = `${userId}/${randomUUID()}.${ext}`;
    const { error } = await this.supabase.storage.from('product-images-private').upload(filename, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw new InternalServerErrorException('Image upload failed');
    // Canonical storage reference; bucket is private, so this is not a public download URL.
    return this.supabase.storage.from('product-images-private').getPublicUrl(filename).data.publicUrl;
  }
  async downloadImage(reference: string) {
    const { bucket, key } = this.imageLocation(reference);
    await this.requirePrivate(bucket);
    const { data, error } = await this.supabase.storage.from(bucket).download(key);
    if (error || !data) throw new InternalServerErrorException('Image unavailable');
    const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    return { buffer: Buffer.from(await data.arrayBuffer()), contentType: types[key.split('.').pop().toLowerCase()] };
  }
}
