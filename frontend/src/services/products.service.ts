import api from './api';
import { Product } from '../types';

export const productsService = {
  getAll: (search?: string) =>
    api.get<Product[]>('/products', { params: { search } }).then((r) => r.data),
  getOne: (id: string) => api.get<Product>(`/products/${id}`).then((r) => r.data),
  isAdmin: () => api.get<{ isAdmin: boolean }>('/products/me/is-admin').then((r) => r.data.isAdmin),
  create: (data: { name: string; unit?: string; categoryId?: string; imageUrl?: string; isGlobal?: boolean }) =>
    api.post<Product>('/products', data).then((r) => r.data),
  update: (id: string, data: { name?: string; unit?: string; categoryId?: string; imageUrl?: string }) =>
    api.put<Product>(`/products/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/products/${id}`),
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ url: string }>('/uploads/product-image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data.url);
  },
};
