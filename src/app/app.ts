import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './core/api.service';
import {
  AppNotification,
  AuthProviders,
  AuthUser,
  DevSummary,
  DevRecipe,
  FeedbackItem,
  FridgeItem,
  Household,
  ItemCategory,
  RecipeSuggestion,
  ShoppingItem,
  SupportMessage,
  SupportTicket,
  Unit,
} from './core/models';

type TabId = 'fridge' | 'shopping' | 'dishes' | 'recipes' | 'profile';
type RecipeTab = 'mine' | 'likes' | 'all';
type ShoppingFilter = 'all' | ItemCategory;
type DishFilter = 'available' | 'almost' | 'planned';
type AuthMode = 'login' | 'register';
type ProfileSection = 'menu' | 'household' | 'notifications' | 'support' | 'feedback';
type DevSection =
  | 'overview'
  | 'users'
  | 'usage'
  | 'features'
  | 'support'
  | 'feedback'
  | 'events'
  | 'infra'
  | 'recipes'
  | 'experiments';

interface OnboardingStep {
  tab: TabId;
  label: string;
  title: string;
  body: string;
  action: string;
}

interface Recipe {
  id: string;
  title: string;
  time: string;
  tags: string[];
  liked: boolean;
  mine: boolean;
  image?: string | null;
  source?: string;
  externalId?: string | null;
  description?: string | null;
  instructions?: string[];
  usedIngredients?: string[];
  missedIngredients?: string[];
}

interface DishIdea {
  id?: string;
  title: string;
  subtitle: string;
  badge: string;
  description: string;
  image?: string | null;
  source?: string;
  externalId?: string | null;
  usedIngredients?: string[];
  missedIngredients?: string[];
  instructions?: string[];
}

interface SwipeState {
  id: string;
  startX: number;
  deltaX: number;
}

type SwipeAction = 'shopping' | 'delete';

const STORAGE_KEYS = {
  recipes: 'eat-it.recipes',
  onboarding: 'eat-it.onboarding.completed',
  notificationsEnabled: 'eat-it.notifications.enabled',
  clearedNotifications: 'eat-it.notifications.cleared',
};

const LEGACY_DEMO_RECIPE_TITLES = new Set([
  'Паста с курицей и томатами',
  'Омлет с зеленью',
  'Теплый салат с фасолью',
]);

const DEV_ALLOWED_EMAILS = new Set(['vladfinder@yandex.ru', 'krisyagodka@gmail.com']);

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    tab: 'fridge',
    label: 'Шаг 1 из 5',
    title: 'Начните с того, что уже есть дома',
    body: 'Добавляйте продукты или бытовую химию, количество и срок годности. Так приложение покажет, что скоро закончится или испортится.',
    action: 'Далее',
  },
  {
    tab: 'shopping',
    label: 'Шаг 2 из 5',
    title: 'Покупки собираются в один список',
    body: 'Отмечайте купленное, меняйте количество и переносите покупки обратно в запасы, когда принесли их домой.',
    action: 'Далее',
  },
  {
    tab: 'dishes',
    label: 'Шаг 3 из 5',
    title: 'Раздел "Блюда" поможет решить, что приготовить',
    body: 'Этот раздел будет подбирать идеи из того, что уже лежит дома, чтобы меньше выбрасывать и быстрее выбирать ужин.',
    action: 'Показать рецепты',
  },
  {
    tab: 'recipes',
    label: 'Шаг 4 из 5',
    title: 'Рецепты сохраняют удачные идеи',
    body: 'Здесь будут ваши рецепты, лайки и общая подборка. Сохраняйте то, что хочется повторить.',
    action: 'Показать профиль',
  },
  {
    tab: 'profile',
    label: 'Шаг 5 из 5',
    title: 'В профиле настраивается общий дом',
    body: 'Переименуйте группу и пригласите участника по email, чтобы вести общий холодильник и список покупок.',
    action: 'Начать пользоваться',
  },
];

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy, OnInit {
  private readonly api = inject(ApiService);
  private refreshTimer: ReturnType<typeof window.setInterval> | null = null;

  protected readonly tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'fridge', label: 'Продукты', icon: 'fridge' },
    { id: 'shopping', label: 'Покупки', icon: 'cart' },
    { id: 'dishes', label: 'Блюда', icon: 'spark' },
    { id: 'recipes', label: 'Рецепты', icon: 'book' },
    { id: 'profile', label: 'Профиль', icon: 'user' },
  ];
  protected readonly devMenu: { id: DevSection; label: string; icon: string }[] = [
    { id: 'overview', label: 'Обзор', icon: '▦' },
    { id: 'users', label: 'Пользователи', icon: '◉' },
    { id: 'usage', label: 'Использование', icon: '↗' },
    { id: 'features', label: 'Популярные функции', icon: '★' },
    { id: 'support', label: 'Поддержка', icon: '?' },
    { id: 'feedback', label: 'Фидбек', icon: '✦' },
    { id: 'events', label: 'Ошибки и события', icon: '!' },
    { id: 'infra', label: 'Инфраструктура', icon: '⌁' },
    { id: 'recipes', label: 'API рецепты', icon: 'SP' },
    { id: 'experiments', label: 'Эксперименты', icon: 'A/B' },
  ];

  protected readonly units: Unit[] = ['шт.', 'г', 'кг', 'мг', 'мл', 'л', 'упак.', 'бан.', 'бут.'];
  protected readonly activeTab = signal<TabId>('fridge');
  protected readonly activeCategory = signal<ItemCategory>('products');
  protected readonly activeShoppingFilter = signal<ShoppingFilter>('all');
  protected readonly activeDishFilter = signal<DishFilter>('available');
  protected readonly activeRecipeTab = signal<RecipeTab>('all');
  protected readonly profileSection = signal<ProfileSection>('menu');
  protected readonly fridgeAddOpen = signal(false);
  protected readonly activeDish = signal<DishIdea | null>(null);
  protected readonly activeRecipe = signal<Recipe | null>(null);
  protected readonly recipeSuggestionsLoading = signal(false);
  protected readonly recipeSuggestionsError = signal('');
  protected readonly dishesLoading = signal(false);
  protected readonly dishesError = signal('');
  protected readonly cookingDish = signal<DishIdea | null>(null);
  protected readonly cookingStepIndex = signal(0);
  protected readonly toastMessage = signal('');
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly newFridgeItem = {
    name: '',
    quantity: 1,
    unit: 'шт.' as Unit,
    expiresAt: this.addDays(5),
    noExpiry: false,
    reminderDays: 1,
  };

  protected readonly newShoppingItem = {
    name: '',
    quantity: 1,
    unit: 'шт.' as Unit,
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
  protected readonly onboardingOpen = signal(false);
  protected readonly onboardingStepIndex = signal(0);
  protected readonly onboardingSteps = ONBOARDING_STEPS;
  protected readonly onboardingStep = computed(
    () => this.onboardingSteps[this.onboardingStepIndex()] ?? this.onboardingSteps[0],
  );
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
  protected readonly notificationsOpen = signal(false);
  protected readonly notificationsEnabled = signal(
    this.load<boolean>(STORAGE_KEYS.notificationsEnabled, true),
  );
  protected readonly clearedNotificationIds = signal(
    this.load<string[]>(STORAGE_KEYS.clearedNotifications, []),
  );
  protected readonly supportTickets = signal<SupportTicket[]>([]);
  protected readonly activeSupportTicket = signal<SupportTicket | null>(null);
  protected readonly supportMessages = signal<SupportMessage[]>([]);
  protected readonly supportForm = {
    subject: '',
    message: '',
    reply: '',
  };
  protected readonly feedbackForm = {
    type: 'idea' as 'idea' | 'bug' | 'other',
    message: '',
  };
  protected readonly devMode = signal(
    window.location.pathname === '/dev' || window.location.pathname === '/debug',
  );
  protected readonly devSummary = signal<DevSummary | null>(null);
  protected readonly devTickets = signal<SupportTicket[]>([]);
  protected readonly devFeedback = signal<FeedbackItem[]>([]);
  protected readonly devRecipes = signal<DevRecipe[]>([]);
  protected readonly activeDevTicket = signal<SupportTicket | null>(null);
  protected readonly devMessages = signal<SupportMessage[]>([]);
  protected readonly devReply = signal('');
  protected readonly activeDevSection = signal<DevSection>('overview');
  protected readonly hasDevAccess = computed(() => {
    const user = this.currentUser();
    const email = user?.email?.trim().toLowerCase();
    return Boolean(user?.isAdmin || (email && DEV_ALLOWED_EMAILS.has(email)));
  });
  protected readonly activeDevSectionLabel = computed(
    () => this.devMenu.find((item) => item.id === this.activeDevSection())?.label ?? 'Оперативная панель',
  );
  protected readonly devLastUpdated = signal('');
  protected readonly devUnansweredTickets = computed(
    () =>
      this.devTickets().filter(
        (ticket) => ticket.status !== 'closed' && ticket.lastMessage?.authorRole !== 'support',
      ).length,
  );
  protected readonly devFeatureRows = computed(() => {
    const summary = this.devSummary();
    const rows = [
      { label: 'Пользователи', count: summary?.users.total ?? 0 },
      { label: 'Дома', count: summary?.households.total ?? 0 },
      { label: 'Продукты дома', count: summary?.usage.fridgeProducts ?? 0 },
      { label: 'Бытовая химия дома', count: summary?.usage.fridgeHousehold ?? 0 },
      { label: 'Покупки', count: summary?.usage.shoppingItems ?? 0 },
      { label: 'Обращения в поддержку', count: summary?.support.openTickets ?? 0 },
      { label: 'Фидбек', count: summary?.support.openFeedback ?? 0 },
    ];
    const max = Math.max(...rows.map((row) => row.count), 1);
    return rows.map((row) => ({ ...row, width: `${Math.max((row.count / max) * 100, 6)}%` }));
  });
  protected readonly devActivityMax = computed(() => {
    const days = this.devSummary()?.activity.days ?? [];
    return Math.max(
      ...days.flatMap((day) => [
        day.users,
        day.sessions,
        day.fridgeItems,
        day.shoppingItems,
        day.supportTickets,
        day.feedback,
      ]),
      1,
    );
  });
  protected readonly fridgeItems = signal<FridgeItem[]>([]);
  protected readonly shoppingItems = signal<ShoppingItem[]>([]);
  protected readonly recipes = signal<Recipe[]>(
    this.load<Recipe[]>(STORAGE_KEYS.recipes, []).filter(
      (recipe) => !LEGACY_DEMO_RECIPE_TITLES.has(recipe.title),
    ),
  );
  protected readonly recipeDishIdeas = signal<DishIdea[]>([]);
  protected readonly userDishIdeas = signal<DishIdea[]>([]);
  protected readonly cookingSteps = [
    'Подготовьте ингредиенты и рабочую поверхность.',
    'Нарежьте овощи и разогрейте сковороду.',
    'Смешайте основу блюда и доведите до готовности.',
    'Разложите по тарелкам и отметьте использованные продукты.',
  ];

  protected readonly visibleFridgeItems = computed(() =>
    this.fridgeItems()
      .filter((item) => item.category === this.activeCategory())
      .sort(
        (left, right) =>
          this.expirySortValue(left).localeCompare(this.expirySortValue(right)) ||
          right.createdAt.localeCompare(left.createdAt),
      ),
  );
  protected readonly expiringSoonCount = computed(
    () =>
      this.visibleFridgeItems().filter(
        (item) => item.expiresAt && this.daysUntil(item.expiresAt) <= item.reminderDays,
      ).length,
  );
  protected readonly expiringSoonItems = computed(() =>
    this.visibleFridgeItems().filter(
      (item) => item.expiresAt && this.daysUntil(item.expiresAt) <= item.reminderDays,
    ),
  );
  protected readonly stableFridgeItems = computed(() =>
    this.visibleFridgeItems().filter(
      (item) => !item.expiresAt || this.daysUntil(item.expiresAt) > item.reminderDays,
    ),
  );
  protected readonly shoppingOpenCount = computed(
    () => this.shoppingItems().filter((item) => !item.checked).length,
  );
  protected readonly visibleShoppingItems = computed(() => {
    const filter = this.activeShoppingFilter();
    return filter === 'all'
      ? this.shoppingItems()
      : this.shoppingItems().filter((item) => item.category === filter);
  });
  protected readonly shoppingProductsCount = computed(
    () => this.shoppingItems().filter((item) => item.category === 'products').length,
  );
  protected readonly shoppingHouseholdCount = computed(
    () => this.shoppingItems().filter((item) => item.category === 'household').length,
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
  protected readonly activeTabSubtitle = computed(() => {
    if (this.activeTab() === 'fridge') {
      return this.activeCategory() === 'products'
        ? 'Сроки, запасы и напоминания'
        : 'Запасы дома без привязки к сроку годности';
    }
    if (this.activeTab() === 'shopping') {
      return 'Общий список для дома';
    }
    if (this.activeTab() === 'dishes') {
      return 'Что приготовить из того, что есть';
    }
    if (this.activeTab() === 'recipes') {
      return 'Сохраняйте любимое и создавайте свое';
    }
    return 'Дом, аккаунт и поддержка';
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
  protected readonly filteredRecipeDishIdeas = computed(() => {
    const filter = this.activeDishFilter();
    return this.userDishIdeas().filter((dish) => {
      const missingCount = dish.missedIngredients?.length ?? 0;
      if (filter === 'available') {
        return missingCount === 0;
      }
      if (filter === 'almost') {
        return missingCount > 0;
      }
      return false;
    });
  });

  private swipe: SwipeState | null = null;
  protected readonly openedSwipeItemId = signal<string | null>(null);
  protected readonly openedSwipeAction = signal<{ id: string; action: SwipeAction } | null>(null);

  ngOnInit(): void {
    void this.initializeSession();
  }

  ngOnDestroy(): void {
    this.stopRealtimeRefresh();
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
      this.openOnboardingIfNeeded(response.user);
      this.startRealtimeRefresh();
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

  protected nextOnboardingStep(): void {
    const nextIndex = this.onboardingStepIndex() + 1;
    if (nextIndex >= this.onboardingSteps.length) {
      this.finishOnboarding();
      return;
    }

    this.onboardingStepIndex.set(nextIndex);
    this.activeTab.set(this.onboardingSteps[nextIndex].tab);
  }

  protected previousOnboardingStep(): void {
    const previousIndex = Math.max(0, this.onboardingStepIndex() - 1);
    this.onboardingStepIndex.set(previousIndex);
    this.activeTab.set(this.onboardingSteps[previousIndex].tab);
  }

  protected skipOnboarding(): void {
    this.finishOnboarding();
  }

  protected restartOnboarding(): void {
    this.onboardingStepIndex.set(0);
    this.activeTab.set(this.onboardingSteps[0].tab);
    this.onboardingOpen.set(true);
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
    if (tab !== 'profile') {
      this.profileSection.set('menu');
    }
    if (tab === 'dishes') {
      void this.loadUserDishes();
    }
    if (tab === 'recipes') {
      void this.loadRecipeCatalog();
    }
  }

  protected setCategory(category: ItemCategory): void {
    this.activeCategory.set(category);
    this.openedSwipeItemId.set(null);
    this.openedSwipeAction.set(null);
    this.newFridgeItem.noExpiry = category === 'household';
    if (category === 'household') {
      this.newFridgeItem.reminderDays = 0;
    } else if (!this.newFridgeItem.reminderDays) {
      this.newFridgeItem.reminderDays = 1;
    }
  }

  protected setShoppingFilter(filter: ShoppingFilter): void {
    this.activeShoppingFilter.set(filter);
  }

  protected setDishFilter(filter: DishFilter): void {
    this.activeDishFilter.set(filter);
  }

  protected setDevSection(section: DevSection): void {
    this.activeDevSection.set(section);
    if (section === 'recipes') {
      void this.loadDevRecipes();
    }
  }

  protected async addFridgeItem(): Promise<void> {
    const name = this.newFridgeItem.name.trim();
    if (!name || this.saving()) {
      return;
    }
    const expiresAt =
      this.activeCategory() === 'household' || this.newFridgeItem.noExpiry
        ? null
        : this.newFridgeItem.expiresAt || this.today;

    await this.runMutation(async () => {
      const item = await firstValueFrom(
        this.api.createFridgeItem({
          name,
          quantity: Number(this.newFridgeItem.quantity) || 1,
          unit: this.newFridgeItem.unit,
          expiresAt,
          reminderDays: expiresAt ? Number(this.newFridgeItem.reminderDays) || 0 : 0,
          category: this.activeCategory(),
        }),
      );
      this.fridgeItems.update((items) => [item, ...items]);

      this.newFridgeItem.name = '';
      this.newFridgeItem.quantity = 1;
      this.newFridgeItem.unit = 'шт.';
      this.newFridgeItem.expiresAt = this.addDays(5);
      this.newFridgeItem.noExpiry = this.activeCategory() === 'household';
      this.newFridgeItem.reminderDays = this.activeCategory() === 'household' ? 0 : 1;
      this.fridgeAddOpen.set(false);
    });
  }

  protected async editFridgeItem(item: FridgeItem): Promise<void> {
    const name = window.prompt('Название товара', item.name)?.trim();
    if (!name) {
      return;
    }
    const quantity = Number(window.prompt('Количество', String(item.quantity)));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    const rawExpiresAt =
      item.category === 'household'
        ? ''
        : window
            .prompt(
              'Годен до (ДД.ММ.ГГГГ), оставьте пустым для товара без срока',
              item.expiresAt ? this.formatDate(item.expiresAt) : '',
            )
            ?.trim() ?? '';
    const expiresAt = rawExpiresAt ? this.parseDisplayDate(rawExpiresAt) : null;
    if (rawExpiresAt && !expiresAt) {
      return;
    }
    const reminderDays = expiresAt
      ? Number(window.prompt('Напомнить за сколько дней?', String(item.reminderDays)))
      : 0;
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
      this.newShoppingItem.unit = 'шт.';
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
    const unit = this.normalizeUnit(
      window.prompt('Единица измерения', this.displayUnit(item.unit ?? 'шт.'))?.trim(),
    );
    if (!unit) {
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
    const rawExpiresAt =
      item.category === 'household'
        ? ''
        : window
            .prompt('Годен до (ДД.ММ.ГГГГ), оставьте пустым для товара без срока', this.formatDate(this.addDays(5)))
            ?.trim() ?? '';
    const expiresAt = rawExpiresAt ? this.parseDisplayDate(rawExpiresAt) : null;
    if (rawExpiresAt && !expiresAt) {
      return;
    }
    const reminderDays = expiresAt ? Number(window.prompt('Напомнить за сколько дней?', '1')) : 0;
    if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
      return;
    }

    await this.runMutation(async () => {
      const fridgeItem = await firstValueFrom(
        this.api.moveShoppingToFridge(item.id, {
          quantity: item.quantity ?? 1,
          unit: this.normalizeUnit(item.unit) ?? 'шт.',
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
    if (this.devMode()) {
      if (this.hasDevAccess()) {
        void this.loadDevData();
      }
      return;
    }
    void this.loadState();
  }

  protected toggleNotifications(): void {
    this.notificationsOpen.update((open) => !open);
  }

  protected closeNotifications(): void {
    this.notificationsOpen.set(false);
  }

  protected toggleNotificationsEnabled(): void {
    const next = !this.notificationsEnabled();
    this.notificationsEnabled.set(next);
    localStorage.setItem(STORAGE_KEYS.notificationsEnabled, JSON.stringify(next));
    this.showToast(next ? 'Уведомления включены' : 'Уведомления выключены');
  }

  protected toggleRecipeLike(id: string): void {
    this.recipes.update((recipes) =>
      recipes.map((recipe) => (recipe.id === id ? { ...recipe, liked: !recipe.liked } : recipe)),
    );
    this.persistRecipes();
  }

  protected openDish(dish: DishIdea): void {
    this.activeDish.set(dish);
  }

  protected closeDish(): void {
    this.activeDish.set(null);
  }

  protected startCooking(dish = this.activeDish()): void {
    if (!dish) {
      return;
    }
    this.activeDish.set(null);
    this.cookingDish.set(dish);
    this.cookingStepIndex.set(0);
  }

  protected closeCooking(): void {
    this.cookingDish.set(null);
    this.cookingStepIndex.set(0);
  }

  protected previousCookingStep(): void {
    this.cookingStepIndex.update((index) => Math.max(index - 1, 0));
  }

  protected nextCookingStep(): void {
    const next = this.cookingStepIndex() + 1;
    if (next >= this.cookingSteps.length) {
      this.showToast('Готовка завершена');
      this.closeCooking();
      return;
    }
    this.cookingStepIndex.set(next);
  }

  protected openRecipe(recipe: Recipe): void {
    this.activeRecipe.set(recipe);
  }

  protected closeRecipe(): void {
    this.activeRecipe.set(null);
  }

  protected setProfileSection(section: ProfileSection): void {
    this.profileSection.set(section);
  }

  protected openFridgeAdd(): void {
    this.newFridgeItem.noExpiry = this.activeCategory() === 'household';
    this.newFridgeItem.reminderDays = this.activeCategory() === 'household' ? 0 : 1;
    this.fridgeAddOpen.set(true);
  }

  protected closeFridgeAdd(): void {
    this.fridgeAddOpen.set(false);
  }

  protected createDish(): void {
    const title = window.prompt('Название блюда')?.trim();
    if (!title) {
      return;
    }
    const ingredients = window
      .prompt('Ингредиенты через запятую', '')
      ?.split(',')
      .map((ingredient) => ingredient.trim())
      .filter(Boolean);
    if (!ingredients?.length) {
      return;
    }
    const imageUrl = window.prompt('Ссылка на картинку блюда', '')?.trim() || undefined;

    void this.createUserDish({ title, imageUrl, ingredients });
  }

  protected defaultRecipeImage(): string {
    return 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=800&q=80';
  }

  protected recipeImage(title?: string | null, image?: string | null): string {
    if (image) {
      return image;
    }
    const queries: Record<string, string> = {
      'Омлет с сыром': 'omelette,cheese,breakfast',
      'Паста с овощами': 'vegetable,pasta',
      'Сырники': 'cheese,pancakes',
      'Рис с курицей': 'chicken,rice,dinner',
    };
    const query = encodeURIComponent(queries[title ?? ''] ?? 'recipe,food');
    return `https://source.unsplash.com/800x600/?${query}`;
  }

  protected async loadRecipeCatalog(): Promise<void> {
    if (this.recipeSuggestionsLoading()) {
      return;
    }

    this.recipeSuggestionsLoading.set(true);
    this.recipeSuggestionsError.set('');
    try {
      const result = await firstValueFrom(this.api.getRecipes());
      const savedById = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
      this.recipeDishIdeas.set(result.recipes.map((recipe) => this.toDishIdea(recipe)));
      this.recipes.update((recipes) => [
        ...recipes.filter((recipe) => recipe.mine),
        ...result.recipes.map((recipe) => this.toRecipe(recipe, savedById.get(recipe.id))),
      ]);
    } catch (error) {
      this.recipeSuggestionsError.set(this.errorMessage(error, 'Не удалось загрузить рецепты.'));
      this.recipeDishIdeas.set([]);
    } finally {
      this.recipeSuggestionsLoading.set(false);
    }
  }

  protected async loadRecipeSuggestions(): Promise<void> {
    if (this.recipeSuggestionsLoading()) {
      return;
    }

    this.recipeSuggestionsLoading.set(true);
    this.recipeSuggestionsError.set('');
    try {
      const result = await firstValueFrom(this.api.getRecipeSuggestions());
      const savedById = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
      this.recipeDishIdeas.set(
        result.recipes.length
          ? result.recipes.map((recipe) => this.toDishIdea(recipe))
          : [],
      );
      this.recipes.update((recipes) => [
        ...recipes.filter((recipe) => recipe.mine),
        ...result.recipes.map((recipe) => this.toRecipe(recipe, savedById.get(recipe.id))),
      ]);
    } catch (error) {
      this.recipeSuggestionsError.set(this.errorMessage(error, 'Не удалось загрузить блюда.'));
      this.recipeDishIdeas.set([]);
    } finally {
      this.recipeSuggestionsLoading.set(false);
    }
  }

  protected async loadUserDishes(): Promise<void> {
    if (this.dishesLoading()) {
      return;
    }

    this.dishesLoading.set(true);
    this.dishesError.set('');
    try {
      const result = await firstValueFrom(this.api.getDishes());
      this.userDishIdeas.set(result.recipes.map((recipe) => this.toDishIdea(recipe)));
    } catch (error) {
      this.dishesError.set(this.errorMessage(error, 'Не удалось загрузить блюда.'));
      this.userDishIdeas.set([]);
    } finally {
      this.dishesLoading.set(false);
    }
  }

  private async createUserDish(input: {
    title: string;
    description?: string;
    imageUrl?: string;
    ingredients: string[];
  }): Promise<void> {
    if (this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const result = await firstValueFrom(this.api.createDish(input));
      this.userDishIdeas.set(result.recipes.map((recipe) => this.toDishIdea(recipe)));
      this.showToast('Блюдо добавлено');
    });
  }

  private toDishIdea(recipe: RecipeSuggestion): DishIdea {
    const missing = recipe.missedIngredientCount;
    return {
      id: recipe.id,
      title: recipe.title,
      subtitle: missing
        ? `Не хватает ${missing} ингредиент${this.ingredientEnding(missing)}`
        : 'Все ингредиенты уже дома',
      badge: `${recipe.matchPercent}%`,
      description:
        recipe.description ??
        (recipe.missedIngredients.length > 0
          ? `Можно приготовить, если докупить: ${recipe.missedIngredients.join(', ')}.`
          : `Подходит под ваши продукты: ${recipe.usedIngredients.join(', ')}.`),
      image: recipe.image,
      source: recipe.source,
      externalId: recipe.externalId,
      usedIngredients: recipe.usedIngredients,
      missedIngredients: recipe.missedIngredients,
      instructions: recipe.instructions,
    };
  }

  private toRecipe(recipe: RecipeSuggestion, saved?: Recipe): Recipe {
    return {
      id: recipe.id,
      title: recipe.title,
      time: recipe.subtitle ?? 'Рецепт из базы',
      tags:
        recipe.missedIngredientCount > 0
          ? [`докупить ${recipe.missedIngredientCount}`, `${recipe.matchPercent}%`]
          : ['все есть', `${recipe.matchPercent}%`],
      liked: saved?.liked ?? false,
      mine: false,
      image: recipe.image,
      source: recipe.source,
      externalId: recipe.externalId,
      description: recipe.description,
      instructions: recipe.instructions,
      usedIngredients: recipe.usedIngredients,
      missedIngredients: recipe.missedIngredients,
    };
  }

  private ingredientEnding(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return '';
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return 'а';
    }
    return 'ов';
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

  protected async createSupportTicket(): Promise<void> {
    const subject = this.supportForm.subject.trim();
    const message = this.supportForm.message.trim();
    if (!subject || !message || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const ticket = await firstValueFrom(this.api.createSupportTicket({ subject, message }));
      this.supportTickets.update((tickets) => [ticket, ...tickets]);
      this.supportForm.subject = '';
      this.supportForm.message = '';
      await this.openSupportTicket(ticket);
    });
  }

  protected async openSupportTicket(ticket: SupportTicket): Promise<void> {
    const result = await firstValueFrom(this.api.getSupportMessages(ticket.id));
    this.activeSupportTicket.set(result.ticket);
    this.supportMessages.set(result.messages);
    this.supportForm.reply = '';
  }

  protected closeSupportDialog(): void {
    this.activeSupportTicket.set(null);
    this.supportMessages.set([]);
    this.supportForm.reply = '';
  }

  protected async sendSupportReply(): Promise<void> {
    const ticket = this.activeSupportTicket();
    const message = this.supportForm.reply.trim();
    if (!ticket || !message || ticket.status === 'closed' || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const created = await firstValueFrom(this.api.sendSupportMessage(ticket.id, message));
      this.supportMessages.update((messages) => [...messages, created]);
      this.supportForm.reply = '';
      await this.loadSupportTickets();
    });
  }

  protected async sendFeedback(): Promise<void> {
    const message = this.feedbackForm.message.trim();
    if (!message || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      await firstValueFrom(this.api.createFeedback({ type: this.feedbackForm.type, message }));
      this.feedbackForm.type = 'idea';
      this.feedbackForm.message = '';
    });
  }

  protected async openDevTicket(ticket: SupportTicket): Promise<void> {
    const result = await firstValueFrom(this.api.getDevSupportMessages(ticket.id));
    this.activeDevTicket.set(result.ticket);
    this.devMessages.set(result.messages);
    this.devReply.set('');
  }

  protected closeDevTicketDialog(): void {
    this.activeDevTicket.set(null);
    this.devMessages.set([]);
    this.devReply.set('');
  }

  protected async sendDevReply(): Promise<void> {
    const ticket = this.activeDevTicket();
    const message = this.devReply().trim();
    if (!ticket || !message || ticket.status === 'closed' || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const created = await firstValueFrom(this.api.sendDevSupportMessage(ticket.id, message));
      this.devMessages.update((messages) => [...messages, created]);
      this.devReply.set('');
      await this.loadDevData();
    });
  }

  protected async closeDevTicket(ticket = this.activeDevTicket()): Promise<void> {
    if (!ticket || ticket.status === 'closed' || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const closed = await firstValueFrom(this.api.closeDevSupportTicket(ticket.id));
      this.activeDevTicket.set(closed);
      await this.loadDevData();
    });
  }

  protected async closeDevFeedback(item: FeedbackItem): Promise<void> {
    if (item.status === 'closed' || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      await firstValueFrom(this.api.closeDevFeedback(item.id));
      await this.loadDevData();
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

  protected async markAllNotificationsRead(): Promise<void> {
    const unread = this.notifications().filter((notification) => !notification.readAt);
    if (!unread.length || this.saving()) {
      return;
    }

    this.saving.set(true);
    try {
      const updated = await Promise.all(
        unread.map((notification) => firstValueFrom(this.api.markNotification(notification.id, true))),
      );
      const updatedById = new Map(updated.map((notification) => [notification.id, notification]));
      this.notifications.update((items) =>
        items.map((item) => updatedById.get(item.id) ?? item),
      );
      this.unreadNotifications.set(0);
      this.showToast('Все уведомления прочитаны');
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось прочитать уведомления.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected clearNotifications(): void {
    const ids = this.notifications().map((notification) => notification.id);
    if (!ids.length) {
      return;
    }
    const nextIds = Array.from(new Set([...this.clearedNotificationIds(), ...ids]));
    this.clearedNotificationIds.set(nextIds);
    localStorage.setItem(STORAGE_KEYS.clearedNotifications, JSON.stringify(nextIds));
    this.notifications.set([]);
    this.unreadNotifications.set(0);
    this.showToast('Уведомления очищены');
  }

  protected beginSwipe(event: PointerEvent, id: string): void {
    this.swipe = { id, startX: event.clientX, deltaX: 0 };
    if (this.openedSwipeItemId() !== id) {
      this.openedSwipeItemId.set(null);
      this.openedSwipeAction.set(null);
    }
  }

  protected moveSwipe(event: PointerEvent, id: string): void {
    if (!this.swipe || this.swipe.id !== id) {
      return;
    }

    this.swipe.deltaX = Math.max(-148, Math.min(148, event.clientX - this.swipe.startX));
  }

  protected endSwipe(id: string): void {
    if (!this.swipe || this.swipe.id !== id) {
      return;
    }

    const item = this.fridgeItems().find((fridgeItem) => fridgeItem.id === id);
    const deltaX = this.swipe.deltaX;
    this.swipe = null;

    if (!item) {
      return;
    }

    if (Math.abs(deltaX) >= 72) {
      this.openedSwipeItemId.set(id);
      this.openedSwipeAction.set({ id, action: deltaX > 0 ? 'shopping' : 'delete' });
      return;
    }

    this.openedSwipeItemId.set(null);
    this.openedSwipeAction.set(null);
  }

  protected swipeOffset(id: string): number {
    if (this.swipe?.id === id) {
      return this.swipe.deltaX;
    }
    const openAction = this.openedSwipeAction();
    if (openAction?.id !== id) {
      return 0;
    }
    return openAction.action === 'shopping' ? 118 : -118;
  }

  protected swipeProgress(id: string): number {
    return Math.min(Math.abs(this.swipeOffset(id)) / 118, 1);
  }

  protected swipeAction(id: string): SwipeAction | null {
    if (this.swipe?.id === id && Math.abs(this.swipe.deltaX) > 8) {
      return this.swipe.deltaX > 0 ? 'shopping' : 'delete';
    }
    const openAction = this.openedSwipeAction();
    return openAction?.id === id ? openAction.action : null;
  }

  protected swipeStyle(id: string): Record<string, string> {
    return {
      '--swipe-progress': String(this.swipeProgress(id)),
      '--swipe-offset': `${this.swipeOffset(id)}px`,
    };
  }

  protected isSwipeActionsOpen(id: string): boolean {
    return this.openedSwipeItemId() === id;
  }

  protected closeSwipeActions(): void {
    this.openedSwipeItemId.set(null);
    this.openedSwipeAction.set(null);
  }

  protected async moveSwipedFridgeToShopping(item: FridgeItem): Promise<void> {
    this.closeSwipeActions();
    await this.moveFridgeToShopping(item);
  }

  protected async deleteSwipedFridgeItem(id: string): Promise<void> {
    this.closeSwipeActions();
    await this.deleteFridgeItem(id);
  }

  protected async runSwipeAction(item: FridgeItem): Promise<void> {
    const action = this.openedSwipeAction();
    if (action?.id !== item.id) {
      return;
    }
    if (action.action === 'shopping') {
      await this.moveSwipedFridgeToShopping(item);
      return;
    }
    await this.deleteSwipedFridgeItem(item.id);
  }

  protected expiryLabel(date: string | null): string {
    if (!date) {
      return 'Без срока';
    }
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

  protected expiryClass(date: string | null): string {
    if (!date) {
      return 'neutral';
    }
    const days = this.daysUntil(date);
    if (days < 0) {
      return 'danger';
    }
    if (days <= 2) {
      return 'warning';
    }
    return 'fresh';
  }

  protected formatDate(date: string | null): string {
    if (!date) {
      return '';
    }
    const [year, month, day] = date.split('-');
    return year && month && day ? `${day}.${month}.${year}` : date;
  }

  protected categoryLabel(category: ItemCategory): string {
    return category === 'products' ? 'Продукты' : 'Бытовая химия';
  }

  protected displayUnit(unit: Unit | string | null | undefined): Unit {
    return this.normalizeUnit(unit) ?? 'шт.';
  }

  protected notificationKindLabel(notification: AppNotification): string {
    if (notification.type === 'group_invite') {
      return 'Группа';
    }
    if (notification.type === 'expiry') {
      return 'Сроки';
    }
    return 'Событие';
  }

  protected notificationIcon(notification: AppNotification): string {
    if (notification.type === 'group_invite') {
      return '👥';
    }
    if (notification.type === 'expiry') {
      return '⏳';
    }
    return '🔔';
  }

  protected notificationTime(value: string): string {
    const date = new Date(value);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
    if (diffMinutes < 1) {
      return 'только что';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes} мин назад`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} ч назад`;
    }
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  }

  protected devActivityHeight(value: number): string {
    return `${Math.max((value / this.devActivityMax()) * 100, value > 0 ? 8 : 2)}%`;
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
      await Promise.all([this.loadNotifications(), this.loadSupportTickets()]);
    } catch {
      this.apiError.set('Не удалось загрузить данные. Проверьте подключение к серверу.');
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshState(): Promise<void> {
    if (!this.currentUser() || this.saving()) {
      return;
    }

    try {
      if (this.devMode()) {
        if (this.hasDevAccess()) {
          await this.loadDevData();
          this.apiError.set('');
        }
        return;
      }

      const state = await firstValueFrom(this.api.getState());
      this.fridgeItems.set(state.fridgeItems);
      this.shoppingItems.set(state.shoppingItems);
      this.household.set(state.household);
      this.groupName.set(state.household.name);
      await Promise.all([this.loadNotifications(), this.loadSupportTickets()]);
      this.apiError.set('');
    } catch {
      // Keep the current UI visible during transient mobile network drops.
    }
  }

  private async loadNotifications(): Promise<void> {
    const result = await firstValueFrom(this.api.getNotifications());
    const cleared = new Set(this.clearedNotificationIds());
    const notifications = result.notifications.filter((notification) => !cleared.has(notification.id));
    this.notifications.set(notifications);
    this.unreadNotifications.set(notifications.filter((notification) => !notification.readAt).length);
  }

  private async loadSupportTickets(): Promise<void> {
    const result = await firstValueFrom(this.api.getSupportTickets());
    this.supportTickets.set(result.tickets);
  }

  private async loadDevData(): Promise<void> {
    const [summary, tickets, feedback] = await Promise.all([
      firstValueFrom(this.api.getDevSummary()),
      firstValueFrom(this.api.getDevSupportTickets()),
      firstValueFrom(this.api.getDevFeedback()),
    ]);
    this.devSummary.set(summary);
    this.devTickets.set(tickets.tickets);
    this.devFeedback.set(feedback.feedback);
    if (this.activeDevSection() === 'recipes') {
      await this.loadDevRecipes();
    }
    this.devLastUpdated.set(new Date().toLocaleTimeString('ru-RU'));
  }

  private async loadDevRecipes(): Promise<void> {
    const result = await firstValueFrom(this.api.getDevRecipes());
    this.devRecipes.set(result.recipes);
  }

  protected recipeSourceLabel(source?: string): string {
    return source === 'spoonacular' ? 'SP' : 'DB';
  }

  protected recipeSourceClass(source?: string): string {
    return source === 'spoonacular' ? 'spoonacular' : 'local';
  }

  protected async deleteFridgeItem(id: string): Promise<void> {
    if (!window.confirm('Удалить позицию из запасов?')) {
      return;
    }

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
      this.applyOAuthResult();
      const [session, providers] = await Promise.allSettled([
        firstValueFrom(this.api.me()),
        firstValueFrom(this.api.getAuthProviders()),
      ]);
      if (providers.status === 'fulfilled') {
        this.authProviders.set(providers.value);
      }
      if (session.status === 'fulfilled') {
        this.currentUser.set(session.value.user);
        if (this.devMode()) {
          if (this.hasDevAccess()) {
            await this.loadDevData();
            this.startRealtimeRefresh();
          }
          return;
        }
        await this.loadState();
        this.openOnboardingIfNeeded(session.value.user);
        this.startRealtimeRefresh();
      }
    } finally {
      this.loading.set(false);
    }
  }

  private applyOAuthResult(): void {
    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (!authError) {
      return;
    }

    const messages: Record<string, string> = {
      google_cancelled: 'Вход через Google отменен.',
      google_failed: 'Не удалось войти через Google. Попробуйте еще раз.',
      apple_cancelled: 'Вход через Apple отменен.',
      apple_failed: 'Не удалось войти через Apple. Попробуйте еще раз.',
    };
    this.authError.set(messages[authError] ?? 'Не удалось войти через внешний сервис.');
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  private resetSession(): void {
    this.stopRealtimeRefresh();
    this.api.clearSessionToken();
    this.currentUser.set(null);
    this.household.set(null);
    this.groupName.set('');
    this.memberEmail.set('');
    this.notifications.set([]);
    this.unreadNotifications.set(0);
    this.notificationsOpen.set(false);
    this.supportTickets.set([]);
    this.activeSupportTicket.set(null);
    this.supportMessages.set([]);
    this.supportForm.subject = '';
    this.supportForm.message = '';
    this.supportForm.reply = '';
    this.feedbackForm.type = 'idea';
    this.feedbackForm.message = '';
    this.devSummary.set(null);
    this.devTickets.set([]);
    this.devFeedback.set([]);
    this.activeDevTicket.set(null);
    this.devMessages.set([]);
    this.devReply.set('');
    this.fridgeItems.set([]);
    this.shoppingItems.set([]);
    this.apiError.set('');
    this.authError.set('');
    this.authMode.set('login');
    this.authForm.password = '';
    this.onboardingOpen.set(false);
    this.onboardingStepIndex.set(0);
    this.activeTab.set('fridge');
  }

  private openOnboardingIfNeeded(user: AuthUser): void {
    if (localStorage.getItem(this.onboardingKey(user.id)) === 'true') {
      return;
    }
    this.onboardingStepIndex.set(0);
    this.activeTab.set(this.onboardingSteps[0].tab);
    this.onboardingOpen.set(true);
  }

  private finishOnboarding(): void {
    const user = this.currentUser();
    if (user) {
      localStorage.setItem(this.onboardingKey(user.id), 'true');
    }
    this.onboardingOpen.set(false);
  }

  private onboardingKey(userId: string): string {
    return `${STORAGE_KEYS.onboarding}.${userId}`;
  }

  private startRealtimeRefresh(): void {
    this.stopRealtimeRefresh();
    this.refreshTimer = window.setInterval(() => {
      void this.refreshState();
    }, 3_000);
  }

  private stopRealtimeRefresh(): void {
    if (!this.refreshTimer) {
      return;
    }
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') {
      return error.error.error;
    }
    return fallback;
  }

  private expirySortValue(item: FridgeItem): string {
    return item.expiresAt ?? '9999-12-31';
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

  private normalizeUnit(unit: Unit | string | null | undefined): Unit | null {
    const normalized = unit?.trim();
    if (!normalized) {
      return null;
    }
    const legacyUnits: Record<string, Unit> = {
      шт: 'шт.',
      упак: 'упак.',
      банка: 'бан.',
      бут: 'бут.',
    };
    const nextUnit = legacyUnits[normalized] ?? (normalized as Unit);
    return this.units.includes(nextUnit) ? nextUnit : null;
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

  private showToast(message: string): void {
    this.toastMessage.set(message);
    window.setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set('');
      }
    }, 2500);
  }
}
