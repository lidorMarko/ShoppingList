export const RELIABLE_ROUTES = {
  'ListsController.create': 'list.create', 'ListsController.update': 'list.update',
  'ListsController.remove': 'list.delete', 'ListsController.copyItems': 'list.copy',
  'ListItemsController.create': 'item.create', 'ListItemsController.update': 'item.update',
  'ListItemsController.remove': 'item.delete', 'ListItemsController.toggle': 'item.toggle',
  'ListItemsController.batch': 'item.batch', 'ListItemsController.setPurchased': 'item.purchase',
} as const;
export type ShoppingOperation = typeof RELIABLE_ROUTES[keyof typeof RELIABLE_ROUTES];
export interface ListBinding { listId: string; ownerId: string; deletedByOperation?: boolean }
export interface MutationResult { operationId?: string; replayed: boolean; httpStatus: number; body: unknown }
