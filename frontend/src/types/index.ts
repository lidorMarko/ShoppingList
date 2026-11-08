export interface Category {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  userId: string | null;
  id: string;
  name: string;
  unit?: string;
  categoryId?: string;
  category?: Category;
  imageUrl?: string;
  avgPrice?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListItem {
  id: string;
  shoppingListId: string;
  productId: string;
  product: Product | null;
  quantity?: number;
  unit?: string;
  notes?: string;
  isPurchased: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ListItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionItem {
  id: string;
  sessionId: string;
  productId: string;
  product: Product | null;
  quantity?: number;
  unit?: string;
  notes?: string;
  isPurchased: boolean;
  price?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptMatchedItem {
  sessionItemId: string;
  productName: string;
  price: number | null;
  found: boolean;
}

export interface ReceiptAnalysis {
  analyzedAt: string;
  storeName: string | null;
  matchedItems: ReceiptMatchedItem[];
  unmatchedReceiptItems: { name: string; price: number }[];
  receiptTotal: number | null;
}

export interface Profile {
  id: string;
  email: string;
  displayName?: string;
  familyId?: string;
  familyRole: string;
  family?: Family;
  createdAt: string;
}

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
  members: Profile[];
  createdAt: string;
}

export interface ShoppingSession {
  id: string;
  shoppingListId: string;
  shoppingList?: ShoppingList;
  status: 'active' | 'completed';
  items: SessionItem[];
  startedAt: string;
  completedAt?: string;
  receiptUrl?: string;
  receiptAnalysis?: ReceiptAnalysis;
}
