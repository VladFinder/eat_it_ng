import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type TabId = 'fridge' | 'shopping' | 'dishes' | 'recipes' | 'profile';
type RecipeTab = 'mine' | 'likes' | 'all';
type Unit = 'шт' | 'г' | 'кг' | 'мл' | 'л' | 'упак' | 'банка' | 'бут';

interface FridgeItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
  expiresAt: string;
  createdAt: string;
}

interface ShoppingItem {
  id: string;
  name: string;
  quantity?: number;
  unit?: Unit;
  checked: boolean;
  createdAt: string;
}

interface Recipe {
  id: string;
  title: string;
  time: string;
  tags: string[];
  liked: boolean;
  mine: boolean;
}

interface SwipeState {
  id: string;
  startX: number;
  deltaX: number;
}

const STORAGE_KEYS = {
  fridge: 'eat-it.fridge',
  shopping: 'eat-it.shopping',
  recipes: 'eat-it.recipes',
  partner: 'eat-it.partner',
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'fridge', label: 'Холодильник', icon: 'fridge' },
    { id: 'shopping', label: 'Покупки', icon: 'cart' },
    { id: 'dishes', label: 'Блюда', icon: 'spark' },
    { id: 'recipes', label: 'Рецепты', icon: 'book' },
    { id: 'profile', label: 'Профиль', icon: 'user' },
  ];

  protected readonly units: Unit[] = ['шт', 'г', 'кг', 'мл', 'л', 'упак', 'банка', 'бут'];
  protected readonly activeTab = signal<TabId>('fridge');
  protected readonly activeRecipeTab = signal<RecipeTab>('mine');
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly newFridgeItem = {
    name: '',
    quantity: 1,
    unit: 'шт' as Unit,
    expiresAt: this.addDays(5),
  };

  protected readonly newShoppingName = signal('');
  protected readonly partnerEmail = signal('');
  protected readonly partnerConnected = signal(this.load<boolean>(STORAGE_KEYS.partner, false));
  protected readonly fridgeItems = signal<FridgeItem[]>(
    this.load<FridgeItem[]>(STORAGE_KEYS.fridge, [
      this.createFridgeItem('Яйца', 10, 'шт', this.addDays(9)),
      this.createFridgeItem('Молоко', 1, 'л', this.addDays(2)),
      this.createFridgeItem('Куриное филе', 700, 'г', this.addDays(1)),
    ]),
  );
  protected readonly shoppingItems = signal<ShoppingItem[]>(
    this.load<ShoppingItem[]>(STORAGE_KEYS.shopping, [
      this.createShoppingItem('Овощи для салата'),
      this.createShoppingItem('Хлеб цельнозерновой'),
    ]),
  );
  protected readonly recipes = signal<Recipe[]>(
    this.load<Recipe[]>(STORAGE_KEYS.recipes, [
      {
        id: crypto.randomUUID(),
        title: 'Паста с курицей и томатами',
        time: '25 мин',
        tags: ['ужин', 'быстро'],
        liked: true,
        mine: false,
      },
      {
        id: crypto.randomUUID(),
        title: 'Омлет с зеленью',
        time: '12 мин',
        tags: ['завтрак', 'из холодильника'],
        liked: false,
        mine: true,
      },
      {
        id: crypto.randomUUID(),
        title: 'Теплый салат с фасолью',
        time: '18 мин',
        tags: ['легко', 'обед'],
        liked: false,
        mine: false,
      },
    ]),
  );

  protected readonly expiringSoonCount = computed(
    () => this.fridgeItems().filter((item) => this.daysUntil(item.expiresAt) <= 2).length,
  );
  protected readonly shoppingOpenCount = computed(
    () => this.shoppingItems().filter((item) => !item.checked).length,
  );
  protected readonly activeTabLabel = computed(
    () => this.tabs.find((tab) => tab.id === this.activeTab())?.label ?? 'Eat it',
  );
  protected readonly recipeList = computed(() => {
    const tab = this.activeRecipeTab();
    return this.recipes().filter((recipe) => {
      if (tab === 'mine') {
        return recipe.mine;
      }
      if (tab === 'likes') {
        return recipe.liked;
      }
      return true;
    });
  });

  private swipe: SwipeState | null = null;

  protected setTab(tab: TabId): void {
    this.activeTab.set(tab);
  }

  protected addFridgeItem(): void {
    const name = this.newFridgeItem.name.trim();
    if (!name) {
      return;
    }

    this.fridgeItems.update((items) => [
      this.createFridgeItem(
        name,
        Number(this.newFridgeItem.quantity) || 1,
        this.newFridgeItem.unit,
        this.newFridgeItem.expiresAt || this.today,
      ),
      ...items,
    ]);
    this.persistFridge();

    this.newFridgeItem.name = '';
    this.newFridgeItem.quantity = 1;
    this.newFridgeItem.unit = 'шт';
    this.newFridgeItem.expiresAt = this.addDays(5);
  }

  protected addShoppingItem(name = this.newShoppingName()): void {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    this.shoppingItems.update((items) => [this.createShoppingItem(trimmed), ...items]);
    this.persistShopping();
    this.newShoppingName.set('');
  }

  protected toggleShoppingItem(id: string): void {
    this.shoppingItems.update((items) =>
      items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
    );
    this.persistShopping();
  }

  protected removeShoppingItem(id: string): void {
    this.shoppingItems.update((items) => items.filter((item) => item.id !== id));
    this.persistShopping();
  }

  protected toggleRecipeLike(id: string): void {
    this.recipes.update((recipes) =>
      recipes.map((recipe) => (recipe.id === id ? { ...recipe, liked: !recipe.liked } : recipe)),
    );
    this.persistRecipes();
  }

  protected connectPartner(): void {
    if (!this.partnerEmail().trim()) {
      return;
    }

    this.partnerConnected.set(true);
    localStorage.setItem(STORAGE_KEYS.partner, JSON.stringify(true));
  }

  protected disconnectPartner(): void {
    this.partnerConnected.set(false);
    this.partnerEmail.set('');
    localStorage.setItem(STORAGE_KEYS.partner, JSON.stringify(false));
  }

  protected beginSwipe(event: PointerEvent, id: string): void {
    this.swipe = { id, startX: event.clientX, deltaX: 0 };
  }

  protected moveSwipe(event: PointerEvent, id: string): void {
    if (!this.swipe || this.swipe.id !== id) {
      return;
    }

    this.swipe.deltaX = Math.max(-96, Math.min(96, event.clientX - this.swipe.startX));
  }

  protected endSwipe(id: string): void {
    if (!this.swipe || this.swipe.id !== id) {
      return;
    }

    const item = this.fridgeItems().find((fridgeItem) => fridgeItem.id === id);
    const deltaX = this.swipe.deltaX;
    this.swipe = null;

    if (!item || Math.abs(deltaX) < 72) {
      return;
    }

    this.fridgeItems.update((items) => items.filter((fridgeItem) => fridgeItem.id !== id));
    this.persistFridge();

    if (deltaX > 0) {
      this.shoppingItems.update((items) => [
        this.createShoppingItem(item.name, item.quantity, item.unit),
        ...items,
      ]);
      this.persistShopping();
    }
  }

  protected swipeOffset(id: string): number {
    return this.swipe?.id === id ? this.swipe.deltaX : 0;
  }

  protected expiryLabel(date: string): string {
    const days = this.daysUntil(date);
    if (days < 0) {
      return `Просрочено ${Math.abs(days)} дн.`;
    }
    if (days === 0) {
      return 'Истекает сегодня';
    }
    if (days === 1) {
      return 'Остался 1 день';
    }
    return `Осталось ${days} дн.`;
  }

  protected expiryClass(date: string): string {
    const days = this.daysUntil(date);
    if (days < 0) {
      return 'danger';
    }
    if (days <= 2) {
      return 'warning';
    }
    return 'fresh';
  }

  private createFridgeItem(name: string, quantity: number, unit: Unit, expiresAt: string): FridgeItem {
    return {
      id: crypto.randomUUID(),
      name,
      quantity,
      unit,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
  }

  private createShoppingItem(name: string, quantity?: number, unit?: Unit): ShoppingItem {
    return {
      id: crypto.randomUUID(),
      name,
      quantity,
      unit,
      checked: false,
      createdAt: new Date().toISOString(),
    };
  }

  private daysUntil(date: string): number {
    const expires = new Date(`${date}T00:00:00`);
    const now = new Date(`${this.today}T00:00:00`);
    return Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
  }

  private addDays(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private load<T>(key: string, fallback: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private persistFridge(): void {
    localStorage.setItem(STORAGE_KEYS.fridge, JSON.stringify(this.fridgeItems()));
  }

  private persistShopping(): void {
    localStorage.setItem(STORAGE_KEYS.shopping, JSON.stringify(this.shoppingItems()));
  }

  private persistRecipes(): void {
    localStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(this.recipes()));
  }
}
