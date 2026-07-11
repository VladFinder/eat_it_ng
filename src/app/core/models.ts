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
  isAdmin?: boolean;
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

export interface AppNotification {
  id: string;
  type: 'group_invite' | 'expiry' | string;
  title: string;
  body: string;
  readAt: string | null;
  data: {
    invitationId?: string;
    householdId?: string;
    fridgeItemId?: string;
    expiresAt?: string;
  } | null;
  createdAt: string;
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

export interface SupportTicket {
  id: string;
  subject: string;
  status: 'open' | 'closed' | string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user?: AuthUser;
  lastMessage: {
    id: string;
    authorRole: string;
    body: string;
    createdAt: string;
  } | null;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  authorRole: 'user' | 'support' | string;
  body: string;
  createdAt: string;
  author?: AuthUser;
}

export interface FeedbackItem {
  id: string;
  type: 'idea' | 'bug' | 'other' | string;
  body: string;
  status: 'open' | 'closed' | string;
  createdAt: string;
  updatedAt: string;
  user?: AuthUser;
}

export interface DevSummary {
  users: {
    total: number;
    online: number;
    recent: AuthUser[];
  };
  usage: {
    fridgeItems: number;
    shoppingItems: number;
  };
  support: {
    openTickets: number;
    closedTickets: number;
    openFeedback: number;
  };
}
