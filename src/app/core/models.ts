export type Unit = 'шт' | 'г' | 'кг' | 'мл' | 'л' | 'упак' | 'банка' | 'бут';
export type ItemCategory = 'products' | 'household';

export interface FridgeItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiresAt: string;
  reminderDays: number;
  category: ItemCategory;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: number | null;
  unit?: Unit | null;
  category: ItemCategory;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  fridgeItems: FridgeItem[];
  shoppingItems: ShoppingItem[];
  household: Household;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  householdId: string;
  authProvider: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  expiresAt: string;
}

export interface AuthProviders {
  password: boolean;
  google: boolean;
  apple: boolean;
}

export interface Household {
  id: string;
  name: string;
  members: AuthUser[];
}

export type FridgeInput = Pick<
  FridgeItem,
  'name' | 'quantity' | 'unit' | 'expiresAt' | 'reminderDays' | 'category'
>;

export type ShoppingInput = {
  name: string;
  quantity?: number;
  unit?: Unit;
  category?: ItemCategory;
};
