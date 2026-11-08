import { Injectable, NestInterceptor, ExecutionContext, CallHandler, NotFoundException } from '@nestjs/common';
import { mergeMap } from 'rxjs/operators';
import { AccessPolicy } from './access-policy.service';

@Injectable()
export class PrivacyInterceptor implements NestInterceptor {
  constructor(private readonly policy: AccessPolicy) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    response.setHeader('Cache-Control', 'no-store');
    return next.handle().pipe(mergeMap(async data => {
      const visit = async (value: any): Promise<any> => {
        if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Date) return value;
        if (Array.isArray(value)) return Promise.all(value.map(visit));
        const copy = { ...value };
        if (copy.product?.id && req.user) {
          try { await this.policy.product(copy.product.id, req.user.id, true); }
          catch (error) { if (!(error instanceof NotFoundException)) throw error; copy.product = null; }
        }
        if (Object.prototype.hasOwnProperty.call(copy, 'receiptUrl') && copy.receiptUrl) {
          copy.receiptUrl = `/api/sessions/${copy.id}/receipt/file`;
        }
        for (const key of Object.keys(copy)) copy[key] = await visit(copy[key]);
        return copy;
      };
      return visit(data);
    }));
  }
}
