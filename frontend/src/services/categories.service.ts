import api from './api';
import { Category } from '../types';

export const categoriesService = {
  getAll: () => api.get<Category[]>('/categories').then((r) => r.data),
  getOne: (id: string) => api.get<Category>(`/categories/${id}`).then((r) => r.data),
  create: (data: { name: string; color?: string }) =>
    api.post<Category>('/categories', data).then((r) => r.data),
  update: (id: string, data: { name?: string; color?: string }) =>
    api.put<Category>(`/categories/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/categories/${id}`),
};
