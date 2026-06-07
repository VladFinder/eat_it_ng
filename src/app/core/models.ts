export type Unit = 'шт' | 'г' | 'кг' | 'мл' | 'л' | 'упак' | 'банка' | 'бут';

export interface FridgeItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: number | null;
  unit?: Unit | null;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  fridgeItems: FridgeItem[];
  shoppingItems: ShoppingItem[];
}

export type FridgeInput = Pick<FridgeItem, 'name' | 'quantity' | 'unit' | 'expiresAt'>;

export type ShoppingInput = {
  name: string;
  quantity?: number;
  unit?: Unit;
};
