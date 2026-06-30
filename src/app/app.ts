import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './core/api.service';
import {
  AppNotification,
  AuthProviders,
  AuthUser,
  FridgeItem,
  Household,
  ItemCategory,
  ShoppingItem,
  Unit,
} from './core/models';

type TabId = 'fridge' | 'shopping' | 'dishes' | 'recipes' | 'profile';
type RecipeTab = 'mine' | 'likes' | 'all';
type AuthMode = 'login' | 'register';

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
  recipes: 'eat-it.recipes',
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'fridge', label: 'Продукты', icon: 'fridge' },
    { id: 'shopping', label: 'Покупки', icon: 'cart' },
    { id: 'dishes', label: 'Блюда', icon: 'spark' },
    { id: 'recipes', label: 'Рецепты', icon: 'book' },
    { id: 'profile', label: 'Профиль', icon: 'user' },
  ];

  protected readonly units: Unit[] = ['шт', 'г', 'кг', 'мл', 'л', 'упак', 'банка', 'бут'];
  protected readonly activeTab = signal<TabId>('fridge');
  protected readonly activeCategory = signal<ItemCategory>('products');
  protected readonly activeRecipeTab = signal<RecipeTab>('mine');
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly newFridgeItem = {
    name: '',
    quantity: 1,
    unit: 'шт' as Unit,
    expiresAt: this.addDays(5),
    reminderDays: 1,
  };

  protected readonly newShoppingItem = {
    name: '',
    quantity: 1,
    unit: 'шт' as Unit,
    category: 'products' as ItemCategory,
  };
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly apiError = signal('');
  protected readonly authMode = signal<AuthMode>('login');
  protected readonly authError = signal('');
  protected readonly currentUser = signal<AuthUser | null>(null);
  protected readonly authProviders = signal<AuthProviders>({
    password: true,
    google: false,
    apple: false,
  });
  protected readonly authForm = {
    displayName: '',
    email: '',
    password: '',
  };
  protected readonly household = signal<Household | null>(null);
  protected readonly groupName = signal('');
  protected readonly memberEmail = signal('');
  protected readonly notifications = signal<AppNotification[]>([]);
  protected readonly unreadNotifications = signal(0);
  protected readonly fridgeItems = signal<FridgeItem[]>([]);
  protected readonly shoppingItems = signal<ShoppingItem[]>([]);
  protected readonly recipes = signal<Recipe[]>(
    this.load<Recipe[]>(STORAGE_KEYS.recipes, [
      {
        id: this.createId(),
        title: 'Паста с курицей и томатами',
        time: '25 мин',
        tags: ['ужин', 'быстро'],
        liked: true,
        mine: false,
      },
      {
        id: this.createId(),
        title: 'Омлет с зеленью',
        time: '12 мин',
        tags: ['завтрак', 'из холодильника'],
        liked: false,
        mine: true,
      },
      {
        id: this.createId(),
        title: 'Теплый салат с фасолью',
        time: '18 мин',
        tags: ['легко', 'обед'],
        liked: false,
        mine: false,
      },
    ]),
  );

  protected readonly visibleFridgeItems = computed(() =>
    this.fridgeItems()
      .filter((item) => item.category === this.activeCategory())
      .sort(
        (left, right) =>
          left.expiresAt.localeCompare(right.expiresAt) ||
          right.createdAt.localeCompare(left.createdAt),
      ),
  );
  protected readonly expiringSoonCount = computed(
    () =>
      this.visibleFridgeItems().filter(
        (item) => this.daysUntil(item.expiresAt) <= item.reminderDays,
      ).length,
  );
  protected readonly shoppingOpenCount = computed(
    () => this.shoppingItems().filter((item) => !item.checked).length,
  );
  protected readonly hasCompletedShoppingItems = computed(() =>
    this.shoppingItems().some((item) => item.checked),
  );
  protected readonly groupMembers = computed(() => this.household()?.members ?? []);
  protected readonly groupTitle = computed(() => this.household()?.name || 'Моя группа');
  protected readonly groupSummary = computed(() => {
    const count = this.groupMembers().length;
    if (count <= 1) {
      return 'Пока только вы. Добавьте участника по email, чтобы вести общий холодильник.';
    }
    return `${count} участника ведут общий холодильник и список покупок.`;
  });
  protected readonly hasNotifications = computed(() => this.notifications().length > 0);
  protected readonly activeTabLabel = computed(() => {
    if (this.activeTab() === 'fridge') {
      return this.activeCategory() === 'products' ? 'Продукты' : 'Бытовая химия';
    }
    return this.tabs.find((tab) => tab.id === this.activeTab())?.label ?? 'Eat it';
  });
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

  ngOnInit(): void {
    void this.initializeSession();
  }

  protected async submitAuth(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.authError.set('');
    try {
      const response =
        this.authMode() === 'register'
          ? await firstValueFrom(
              this.api.register({
                displayName: this.authForm.displayName.trim(),
                email: this.authForm.email.trim(),
                password: this.authForm.password,
              }),
            )
          : await firstValueFrom(
              this.api.login({
                email: this.authForm.email.trim(),
                password: this.authForm.password,
              }),
            );
      this.api.setSessionToken(response.token);
      this.currentUser.set(response.user);
      this.authForm.password = '';
      await this.loadState();
    } catch (error) {
      this.authError.set(this.errorMessage(error, 'Не удалось войти в аккаунт.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected setAuthMode(mode: AuthMode): void {
    this.authMode.set(mode);
    this.authError.set('');
  }

  protected startOAuth(provider: 'google' | 'apple'): void {
    window.location.assign(this.api.oauthUrl(provider));
  }

  protected async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.resetSession();
    }
  }

  protected async deleteAccount(): Promise<void> {
    if (!window.confirm('Удалить аккаунт и завершить текущую сессию?')) {
      return;
    }
    try {
      await firstValueFrom(this.api.deleteAccount());
      this.resetSession();
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось удалить аккаунт.'));
    }
  }

  protected setTab(tab: TabId): void {
    this.activeTab.set(tab);
  }

  protected async addFridgeItem(): Promise<void> {
    const name = this.newFridgeItem.name.trim();
    if (!name || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const item = await firstValueFrom(
        this.api.createFridgeItem({
          name,
          quantity: Number(this.newFridgeItem.quantity) || 1,
          unit: this.newFridgeItem.unit,
          expiresAt: this.newFridgeItem.expiresAt || this.today,
          reminderDays: Number(this.newFridgeItem.reminderDays) || 0,
          category: this.activeCategory(),
        }),
      );
      this.fridgeItems.update((items) => [item, ...items]);

      this.newFridgeItem.name = '';
      this.newFridgeItem.quantity = 1;
      this.newFridgeItem.unit = 'шт';
      this.newFridgeItem.expiresAt = this.addDays(5);
      this.newFridgeItem.reminderDays = 1;
    });
  }

  protected async editFridgeItem(item: FridgeItem): Promise<void> {
    const name = window.prompt('Название продукта', item.name)?.trim();
    if (!name) {
      return;
    }
    const quantity = Number(window.prompt('Количество', String(item.quantity)));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    const expiresAt = this.parseDisplayDate(
      window.prompt('Годен до (ДД.ММ.ГГГГ)', this.formatDate(item.expiresAt))?.trim() ?? '',
    );
    if (!expiresAt) {
      return;
    }
    const reminderDays = Number(
      window.prompt('Напомнить за сколько дней?', String(item.reminderDays)),
    );
    if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
      return;
    }

    await this.runMutation(async () => {
      const updated = await firstValueFrom(
        this.api.updateFridgeItem(item.id, { name, quantity, expiresAt, reminderDays }),
      );
      this.replaceFridgeItem(updated);
    });
  }

  protected async consumeFridgeItem(item: FridgeItem): Promise<void> {
    const quantity = Number(window.prompt(`Сколько израсходовано (${item.unit})?`, '1'));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }

    await this.runMutation(async () => {
      const result = await firstValueFrom(this.api.consumeFridgeItem(item.id, quantity));
      if (result.removed || !result.item) {
        this.fridgeItems.update((items) => items.filter((current) => current.id !== item.id));
      } else {
        this.replaceFridgeItem(result.item);
      }
    });
  }

  protected async addShoppingItem(name = this.newShoppingItem.name): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const item = await firstValueFrom(
        this.api.createShoppingItem({
          name: trimmed,
          quantity: Number(this.newShoppingItem.quantity) || 1,
          unit: this.newShoppingItem.unit,
          category: this.newShoppingItem.category,
        }),
      );
      this.shoppingItems.update((items) => [item, ...items]);
      this.newShoppingItem.name = '';
      this.newShoppingItem.quantity = 1;
      this.newShoppingItem.unit = 'шт';
    });
  }

  protected async toggleShoppingItem(item: ShoppingItem): Promise<void> {
    await this.runMutation(async () => {
      const updated = await firstValueFrom(
        this.api.updateShoppingItem(item.id, { checked: !item.checked }),
      );
      this.replaceShoppingItem(updated);
    });
  }

  protected async removeShoppingItem(id: string): Promise<void> {
    if (!window.confirm('Удалить покупку из списка?')) {
      return;
    }
    await this.runMutation(async () => {
      await firstValueFrom(this.api.deleteShoppingItem(id));
      this.shoppingItems.update((items) => items.filter((item) => item.id !== id));
    });
  }

  protected async editShoppingItem(item: ShoppingItem): Promise<void> {
    const quantity = Number(window.prompt('Количество', String(item.quantity ?? 1)));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    const unit = window.prompt('Единица измерения', item.unit ?? 'шт')?.trim() as Unit | undefined;
    if (!unit || !this.units.includes(unit)) {
      return;
    }

    await this.runMutation(async () => {
      const updated = await firstValueFrom(
        this.api.updateShoppingItem(item.id, { quantity, unit }),
      );
      this.replaceShoppingItem(updated);
    });
  }

  protected async moveShoppingToFridge(item: ShoppingItem): Promise<void> {
    const expiresAt = this.parseDisplayDate(
      window.prompt('Годен до (ДД.ММ.ГГГГ)', this.formatDate(this.addDays(5)))?.trim() ?? '',
    );
    if (!expiresAt) {
      return;
    }
    const reminderDays = Number(window.prompt('Напомнить за сколько дней?', '1'));
    if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
      return;
    }

    await this.runMutation(async () => {
      const fridgeItem = await firstValueFrom(
        this.api.moveShoppingToFridge(item.id, {
          quantity: item.quantity ?? 1,
          unit: item.unit ?? 'шт',
          expiresAt,
          reminderDays,
          category: item.category,
        }),
      );
      this.shoppingItems.update((items) => items.filter((current) => current.id !== item.id));
      this.fridgeItems.update((items) => [fridgeItem, ...items]);
    });
  }

  protected async clearCompletedShoppingItems(): Promise<void> {
    if (!this.shoppingItems().some((item) => item.checked)) {
      return;
    }
    await this.runMutation(async () => {
      await firstValueFrom(this.api.clearCompletedShoppingItems());
      this.shoppingItems.update((items) => items.filter((item) => !item.checked));
    });
  }

  protected retryLoad(): void {
    void this.loadState();
  }

  protected toggleRecipeLike(id: string): void {
    this.recipes.update((recipes) =>
      recipes.map((recipe) => (recipe.id === id ? { ...recipe, liked: !recipe.liked } : recipe)),
    );
    this.persistRecipes();
  }

  protected async saveGroupName(): Promise<void> {
    const name = this.groupName().trim();
    if (!name || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const household = await firstValueFrom(this.api.renameHousehold(name));
      this.household.set(household);
      this.groupName.set(household.name);
    });
  }

  protected async addGroupMember(): Promise<void> {
    const email = this.memberEmail().trim();
    if (!email || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      await firstValueFrom(this.api.addHouseholdMember(email));
      this.memberEmail.set('');
      await this.loadNotifications();
    });
  }

  protected async respondToInvitation(
    notification: AppNotification,
    action: 'accept' | 'decline',
  ): Promise<void> {
    const invitationId = notification.data?.invitationId;
    if (!invitationId || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const household = await firstValueFrom(this.api.respondToInvitation(invitationId, action));
      this.household.set(household);
      this.groupName.set(household.name);
      await firstValueFrom(this.api.markNotification(notification.id, true));
      await this.loadState();
      await this.loadNotifications();
    });
  }

  protected async markNotificationRead(notification: AppNotification): Promise<void> {
    if (notification.readAt || this.saving()) {
      return;
    }
    const updated = await firstValueFrom(this.api.markNotification(notification.id, true));
    this.notifications.update((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
    this.unreadNotifications.update((count) => Math.max(0, count - 1));
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

    if (deltaX > 0) {
      void this.moveFridgeToShopping(item);
      return;
    }

    if (window.confirm(`Удалить «${item.name}» из холодильника?`)) {
      void this.deleteFridgeItem(item.id);
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

  protected formatDate(date: string): string {
    const [year, month, day] = date.split('-');
    return year && month && day ? `${day}.${month}.${year}` : date;
  }

  protected categoryLabel(category: ItemCategory): string {
    return category === 'products' ? 'Продукты' : 'Бытовая химия';
  }

  private async loadState(): Promise<void> {
    this.loading.set(true);
    this.apiError.set('');
    try {
      const state = await firstValueFrom(this.api.getState());
      this.fridgeItems.set(state.fridgeItems);
      this.shoppingItems.set(state.shoppingItems);
      this.household.set(state.household);
      this.groupName.set(state.household.name);
      await this.loadNotifications();
    } catch {
      this.apiError.set('Не удалось загрузить данные. Проверьте подключение к серверу.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadNotifications(): Promise<void> {
    const result = await firstValueFrom(this.api.getNotifications());
    this.notifications.set(result.notifications);
    this.unreadNotifications.set(result.unreadCount);
  }

  private async deleteFridgeItem(id: string): Promise<void> {
    await this.runMutation(async () => {
      await firstValueFrom(this.api.deleteFridgeItem(id));
      this.fridgeItems.update((items) => items.filter((item) => item.id !== id));
    });
  }

  private async moveFridgeToShopping(item: FridgeItem): Promise<void> {
    await this.runMutation(async () => {
      const shoppingItem = await firstValueFrom(this.api.moveFridgeToShopping(item.id));
      this.fridgeItems.update((items) => items.filter((current) => current.id !== item.id));
      this.shoppingItems.update((items) => [shoppingItem, ...items]);
    });
  }

  private async runMutation(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.apiError.set('');
    try {
      await action();
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Изменение не сохранено. Повторите попытку.'));
    } finally {
      this.saving.set(false);
    }
  }

  private replaceFridgeItem(updated: FridgeItem): void {
    this.fridgeItems.update((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  private replaceShoppingItem(updated: ShoppingItem): void {
    this.shoppingItems.update((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  private async initializeSession(): Promise<void> {
    this.loading.set(true);
    try {
      const [session, providers] = await Promise.allSettled([
        firstValueFrom(this.api.me()),
        firstValueFrom(this.api.getAuthProviders()),
      ]);
      if (providers.status === 'fulfilled') {
        this.authProviders.set(providers.value);
      }
      if (session.status === 'fulfilled') {
        this.currentUser.set(session.value.user);
        await this.loadState();
      }
    } finally {
      this.loading.set(false);
    }
  }

  private resetSession(): void {
    this.api.clearSessionToken();
    this.currentUser.set(null);
    this.household.set(null);
    this.groupName.set('');
    this.memberEmail.set('');
    this.notifications.set([]);
    this.unreadNotifications.set(0);
    this.fridgeItems.set([]);
    this.shoppingItems.set([]);
    this.apiError.set('');
    this.authError.set('');
    this.authMode.set('login');
    this.authForm.password = '';
    this.activeTab.set('fridge');
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }
    return fallback;
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

  private parseDisplayDate(value: string): string | null {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) {
      return null;
    }
    const [, day, month, year] = match;
    const normalized = `${year}-${month}-${day}`;
    const date = new Date(`${normalized}T00:00:00Z`);
    return date.toISOString().slice(0, 10) === normalized ? normalized : null;
  }

  private createId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
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

  private persistRecipes(): void {
    localStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(this.recipes()));
  }
}
