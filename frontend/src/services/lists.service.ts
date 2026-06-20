import api from './api';
import { ShoppingList, ListItem } from '../types';

export const listsService = {
  getAll: () => api.get<ShoppingList[]>('/lists').then((r) => r.data),
  getOne: (id: string) => api.get<ShoppingList>(`/lists/${id}`).then((r) => r.data),
  create: (data: { name: string }) => api.post<ShoppingList>('/lists', data).then((r) => r.data),
  update: (id: string, data: { name: string }) =>
    api.put<ShoppingList>(`/lists/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/lists/${id}`),
  copyItems: (sourceId: string, targetListId: string) =>
    api.post<ShoppingList>(`/lists/${sourceId}/copy-items`, { targetListId }).then((r) => r.data),
};

export const listItemsService = {
  getAll: (listId: string) =>
    api.get<ListItem[]>(`/lists/${listId}/items`).then((r) => r.data),
  create: (
    listId: string,
    data: { productId: string; quantity?: number; unit?: string; notes?: string },
  ) => api.post<ListItem>(`/lists/${listId}/items`, data).then((r) => r.data),
  update: (
    listId: string,
    itemId: string,
    data: { quantity?: number; unit?: string; notes?: string; isPurchased?: boolean },
  ) => api.put<ListItem>(`/lists/${listId}/items/${itemId}`, data).then((r) => r.data),
  toggle: (listId: string, itemId: string) =>
    api.patch<ListItem>(`/lists/${listId}/items/${itemId}/toggle`).then((r) => r.data),
  remove: (listId: string, itemId: string) =>
    api.delete(`/lists/${listId}/items/${itemId}`),
};
