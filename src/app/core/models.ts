export type Unit =
  | 'шт.'
  | 'шт'
  | 'г'
  | 'кг'
  | 'мг'
  | 'мл'
  | 'л'
  | 'упак.'
  | 'упак'
  | 'бан.'
  | 'банка'
  | 'бут.'
  | 'бут';
export type ItemCategory = 'products' | 'household' | 'medicine';

export interface FridgeItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiresAt: string | null;
  reminderDays: number;
  autoAddToShopping: boolean;
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

export interface RecipeSuggestion {
  id: string;
  title: string;
  image: string | null;
  source?: 'catalog' | 'spoonacular' | 'user' | string;
  externalId?: string | null;
  subtitle?: string | null;
  description?: string | null;
  instructions?: string[];
  usedIngredientCount: number;
  missedIngredientCount: number;
  expiringIngredientCount: number;
  matchPercent: number;
  usedIngredients: string[];
  missedIngredients: string[];
}

export interface RecipeShoppingResult {
  items: ShoppingItem[];
  addedCount: number;
  skippedCount: number;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface MealPlanEntry {
  id: string;
  date: string;
  mealType: MealType;
  createdAt: string;
  updatedAt: string;
  dish: {
    id: string;
    title: string;
    image: string | null;
    subtitle: string | null;
    source: string;
  };
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
  subscription: HouseholdSubscription;
}

export interface HouseholdSubscription {
  plan: 'free' | 'plus';
  status: 'inactive' | 'trialing' | 'active' | 'past_due' | 'canceled' | string;
  provider: 'none' | 'admin' | 'rustore' | 'google_play' | 'app_store' | 'web' | string;
  currentPeriodEnd: string | null;
  isPlus: boolean;
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

export interface NotificationPreferences {
  notifyExpiry: boolean;
  notifyShopping: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string;
}

export type FridgeInput = Pick<
  FridgeItem,
  'name' | 'quantity' | 'unit' | 'expiresAt' | 'reminderDays' | 'autoAddToShopping' | 'category'
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
    fridgeProducts: number;
    fridgeHousehold: number;
    shoppingProducts: number;
    shoppingHousehold: number;
    checkedShoppingItems: number;
    expiringFridgeItems: number;
  };
  support: {
    openTickets: number;
    closedTickets: number;
    openFeedback: number;
    closedFeedback: number;
    newTicketsToday: number;
    newFeedbackToday: number;
  };
  households: {
    total: number;
    pendingInvitations: number;
  };
  notifications: {
    unread: number;
  };
  sessions: {
    active: number;
    onlineWindowMinutes: number;
  };
  today: {
    newUsers: number;
    newTickets: number;
    newFeedback: number;
  };
  activity: {
    days: Array<{
      date: string;
      users: number;
      sessions: number;
      fridgeItems: number;
      shoppingItems: number;
      supportTickets: number;
      feedback: number;
    }>;
  };
  events: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    createdAt: string;
  }>;
}

export interface DevRecipe {
  id: string;
  externalId: string | null;
  title: string;
  source: string;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  ingredients: string[];
}
