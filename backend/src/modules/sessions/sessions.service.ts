import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
import { v4 as uuid } from 'uuid';
import { ShoppingSession } from '../../database/entities/shopping-session.entity';
import { SessionItem } from '../../database/entities/session-item.entity';
import { ShoppingList } from '../../database/entities/shopping-list.entity';
import { Profile } from '../../database/entities/profile.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { AddSessionItemDto, UpdateSessionItemDto } from './dto/update-session-item.dto';

interface ReceiptMatchedItem {
  sessionItemId: string;
  productName: string;
  price: number | null;
  found: boolean;
}

interface UnmatchedReceiptItem {
  name: string;
  price: number;
}

interface ReceiptAnalysisResult {
  analyzedAt: string;
  storeName: string | null;
  matchedItems: ReceiptMatchedItem[];
  unmatchedReceiptItems: UnmatchedReceiptItem[];
  receiptTotal: number | null;
}

@Injectable()
export class SessionsService {
  private supabase;
  private openai: OpenAI;

  constructor(
    @InjectRepository(ShoppingSession)
    private readonly sessionRepo: Repository<ShoppingSession>,
    @InjectRepository(SessionItem)
    private readonly itemRepo: Repository<SessionItem>,
    @InjectRepository(ShoppingList)
    private readonly listRepo: Repository<ShoppingList>,
    @InjectRepository(Profile)
    private readonly profileRepo: Repository<Profile>,
    private readonly config: ConfigService,
  ) {
    this.supabase = createClient(
      config.get<string>('SUPABASE_URL'),
      config.get<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    this.openai = new OpenAI({
      apiKey: config.get<string>('OPENAI_API_KEY'),
    });
  }

  private async visibleListIds(userId: string): Promise<string[]> {
    const profile = await this.profileRepo.findOne({ where: { id: userId } });
    const userIds = profile?.familyId
      ? (await this.profileRepo.find({ where: { familyId: profile.familyId } })).map((m) => m.id)
      : [userId];
    const lists = await this.listRepo.find({ where: { userId: In(userIds) }, select: ['id'] });
    return lists.map((l) => l.id);
  }

  async findAll(userId: string): Promise<ShoppingSession[]> {
    const listIds = await this.visibleListIds(userId);
    if (listIds.length === 0) return [];
    return this.sessionRepo.find({
      where: { shoppingListId: In(listIds) },
      relations: ['shoppingList', 'items'],
      order: { startedAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ShoppingSession> {
    const session = await this.sessionRepo.findOne({
      where: { id },
      relations: [
        'shoppingList',
        'items',
        'items.product',
        'items.product.category',
      ],
    });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  async create(dto: CreateSessionDto): Promise<ShoppingSession> {
    const list = await this.listRepo.findOne({
      where: { id: dto.shoppingListId },
      relations: ['items', 'items.product'],
    });
    if (!list) throw new NotFoundException(`Shopping list not found`);

    const session = this.sessionRepo.create({
      shoppingListId: dto.shoppingListId,
      status: 'active',
    });
    const saved = await this.sessionRepo.save(session);

    const sessionItems = list.items.map((item) =>
      this.itemRepo.create({
        sessionId: saved.id,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        notes: item.notes,
        isPurchased: false,
      }),
    );

    if (sessionItems.length > 0) {
      await this.itemRepo.save(sessionItems);
    }

    return this.findOne(saved.id);
  }

  async complete(id: string): Promise<ShoppingSession> {
    const session = await this.findOne(id);
    if (session.status === 'completed') {
      throw new BadRequestException('Session is already completed');
    }
    session.status = 'completed';
    session.completedAt = new Date();
    await this.sessionRepo.save(session);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const session = await this.findOne(id);
    await this.sessionRepo.remove(session);
  }

  // --- Session items ---

  async addItem(sessionId: string, dto: AddSessionItemDto): Promise<SessionItem> {
    await this.findOne(sessionId);
    const item = this.itemRepo.create({ ...dto, sessionId, isPurchased: false });
    return this.itemRepo.save(item);
  }

  async updateItem(
    sessionId: string,
    itemId: string,
    dto: UpdateSessionItemDto,
  ): Promise<SessionItem> {
    const item = await this.itemRepo.findOne({ where: { id: itemId, sessionId } });
    if (!item) throw new NotFoundException(`Session item not found`);
    Object.assign(item, dto);
    return this.itemRepo.save(item);
  }

  async toggleItem(sessionId: string, itemId: string): Promise<SessionItem> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, sessionId },
      relations: ['product', 'product.category'],
    });
    if (!item) throw new NotFoundException(`Session item not found`);
    item.isPurchased = !item.isPurchased;
    return this.itemRepo.save(item);
  }

  async removeItem(sessionId: string, itemId: string): Promise<void> {
    const item = await this.itemRepo.findOne({ where: { id: itemId, sessionId } });
    if (!item) throw new NotFoundException(`Session item not found`);
    await this.itemRepo.remove(item);
  }

  // --- Receipt ---

  private receiptLocation(session: ShoppingSession): { bucket: string; key: string } {
    const stored = session.receiptUrl;
    if (!stored) throw new BadRequestException('No receipt uploaded');
    let bucket = 'receipts-private', key: string;
    if (stored.startsWith('private:')) key = stored.slice(8);
    else {
      // Legacy URLs are parsed, never fetched. Only this project's receipt objects are accepted.
      let url: URL;
      try { url = new URL(stored); } catch { throw new BadRequestException('Invalid receipt reference'); }
      const project = new URL(this.config.get<string>('SUPABASE_URL'));
      const prefix = '/storage/v1/object/public/receipts/';
      if (url.origin !== project.origin || !url.pathname.startsWith(prefix) || url.username || url.password || url.search || url.hash) throw new BadRequestException('Invalid receipt reference');
      bucket = 'receipts';
      try { key = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { throw new BadRequestException('Invalid receipt reference'); }
    }
    if (!new RegExp(`^${session.id}-[0-9a-f-]{36}\\.(jpg|jpeg|png|gif|webp|pdf)$`, 'i').test(key)) throw new BadRequestException('Invalid receipt reference');
    return { bucket, key };
  }

  private async requirePrivateBucket(bucket: string) {
    const { data, error } = await this.supabase.storage.getBucket(bucket);
    if (error || !data || data.public !== false) throw new InternalServerErrorException('Private receipt storage must be configured');
  }

  async downloadReceipt(sessionId: string) {
    const session = await this.findOne(sessionId);
    const { bucket, key } = this.receiptLocation(session);
    await this.requirePrivateBucket(bucket);
    const { data, error } = await this.supabase.storage.from(bucket).download(key);
    if (error || !data) throw new InternalServerErrorException('Receipt unavailable');
    const ext = key.split('.').pop().toLowerCase();
    const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };
    return { buffer: Buffer.from(await data.arrayBuffer()), contentType: types[ext], filename: key };
  }

  async uploadReceipt(sessionId: string, file: Express.Multer.File): Promise<ShoppingSession> {
    const session = await this.findOne(sessionId);
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    const ext = extensions[file.mimetype];
    if (!ext) throw new BadRequestException('Unsupported receipt type');
    await this.requirePrivateBucket('receipts-private');
    const filename = `${sessionId}-${uuid()}.${ext}`;
    const { error } = await this.supabase.storage.from('receipts-private').upload(filename, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw new InternalServerErrorException('Receipt upload failed');
    session.receiptUrl = `private:${filename}`;
    await this.sessionRepo.save(session);
    return this.findOne(sessionId);
  }

  async analyzeReceipt(sessionId: string): Promise<ShoppingSession> {
    const session = await this.findOne(sessionId);
    const { buffer, contentType } = await this.downloadReceipt(sessionId);
    const isPdf = contentType === 'application/pdf';

    // Build the product list for the prompt
    const items = session.items ?? [];
    const productList = items
      .map((item) => `- ID: ${item.id} | Name: ${item.product?.name ?? 'Unknown'}`)
      .join('\n');

    const jsonSchema = `{
  "storeName": "<store/supermarket name, or null if not visible>",
  "matchedItems": [
    { "sessionItemId": "<exact ID from list>", "productName": "<name>", "price": <number or null>, "found": <true or false> }
  ],
  "unmatchedReceiptItems": [
    { "name": "<item name on receipt>", "price": <number> }
  ],
  "receiptTotal": <total amount as number, or null if not visible>
}`;

    const systemPrompt = `You are a receipt scanner assistant. Extract purchased items and prices from receipts. Always respond with valid JSON only — no markdown, no explanation.`;

    let userContent: OpenAI.Chat.ChatCompletionContentPart[];

    if (isPdf) {
      // GPT-4o doesn't accept PDFs directly — extract text first
      const pdfData = await pdfParse(buffer);
      const pdfText = pdfData.text;

      userContent = [
        {
          type: 'text',
          text: `Here is the text extracted from a receipt PDF:\n\n${pdfText}\n\nMy shopping list:\n${productList}\n\nReturn ONLY this JSON structure:\n${jsonSchema}\n\nInclude ALL products from my list in matchedItems. Use the exact sessionItemId values provided.`,
        },
      ];
    } else {
      const base64 = buffer.toString('base64');
      const mediaType = contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

      userContent = [
        {
          type: 'image_url',
          image_url: { url: `data:${mediaType};base64,${base64}` },
        },
        {
          type: 'text',
          text: `My shopping list:\n${productList}\n\nReturn ONLY this JSON structure:\n${jsonSchema}\n\nInclude ALL products from my list in matchedItems. Use the exact sessionItemId values provided.`,
        },
      ];
    }

    let analysisResult: ReceiptAnalysisResult;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      const raw = (completion.choices[0].message.content ?? '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');

      const parsed = JSON.parse(raw);
      analysisResult = {
        analyzedAt: new Date().toISOString(),
        storeName: parsed.storeName ?? null,
        matchedItems: parsed.matchedItems ?? [],
        unmatchedReceiptItems: parsed.unmatchedReceiptItems ?? [],
        receiptTotal: parsed.receiptTotal ?? null,
      };
    } catch (err) {
      throw new InternalServerErrorException('Receipt analysis failed');
    }

    // Mark found items as purchased and store their price
    const foundItems = analysisResult.matchedItems.filter((m) => m.found);
    for (const match of foundItems) {
      await this.itemRepo.update(
        { id: match.sessionItemId, sessionId },
        { isPurchased: true, ...(match.price != null && { price: match.price }) },
      );
    }

    session.receiptAnalysis = analysisResult as unknown as Record<string, unknown>;
    await this.sessionRepo.save(session);

    return this.findOne(sessionId);
  }
}
