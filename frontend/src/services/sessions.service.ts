import api from './api';
import { ShoppingSession, SessionItem } from '../types';

export const sessionsService = {
  getAll: () => api.get<ShoppingSession[]>('/sessions').then((r) => r.data),
  getOne: (id: string) => api.get<ShoppingSession>(`/sessions/${id}`).then((r) => r.data),
  create: (shoppingListId: string) =>
    api.post<ShoppingSession>('/sessions', { shoppingListId }).then((r) => r.data),
  complete: (id: string) =>
    api.patch<ShoppingSession>(`/sessions/${id}/complete`).then((r) => r.data),
  remove: (id: string) => api.delete(`/sessions/${id}`),

  addItem: (sessionId: string, data: { productId: string; quantity?: number; unit?: string; notes?: string }) =>
    api.post<SessionItem>(`/sessions/${sessionId}/items`, data).then((r) => r.data),
  updateItem: (sessionId: string, itemId: string, data: { isPurchased?: boolean; quantity?: number; unit?: string; notes?: string }) =>
    api.patch<SessionItem>(`/sessions/${sessionId}/items/${itemId}`, data).then((r) => r.data),
  toggleItem: (sessionId: string, itemId: string) =>
    api.patch<SessionItem>(`/sessions/${sessionId}/items/${itemId}/toggle`).then((r) => r.data),
  removeItem: (sessionId: string, itemId: string) =>
    api.delete(`/sessions/${sessionId}/items/${itemId}`),

  uploadReceipt: (sessionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<ShoppingSession>(`/sessions/${sessionId}/receipt`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  analyzeReceipt: (sessionId: string) =>
    api.post<ShoppingSession>(`/sessions/${sessionId}/analyze-receipt`).then((r) => r.data),
};
