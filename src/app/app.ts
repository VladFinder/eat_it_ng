import { LiveUpdateService } from './core/live-update.service';
import { LiveUpdateComponent } from './core/live-update.component';
import { NativeOAuthService } from './core/native-oauth.service';
import { RECIPE_MEAL_TYPES, RecipeMealType } from './core/recipe-meal-types';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  eligibleRecipes,
  pickRecipe,
  RecipePickMode,
  RecipePickSource,
} from './core/recipe-picker';
import { LoadMoreDirective } from './core/load-more.directive';
import { IconComponent, IconName } from './ui/icon.component';
import { BarcodeAddComponent, BarcodeAddition } from './barcode-add/barcode-add.component';
import { ApiService } from './core/api.service';
import {
  AppNotification,
  AuthProviders,
  AuthUser,
  AuthResponse,
  DevSummary,
  DevRecipe,
  DevProduct,
  TranslationStatus,
  DevUser,
  FeedbackItem,
  FridgeItem,
  Household,
  ItemCategory,
  MealPlanEntry,
  MealType,
  NotificationPreferences,
  RecipeSuggestion,
  ShoppingItem,
  SupportMessage,
  SupportTicket,
  Unit,
} from './core/models';

type TabId = 'fridge' | 'shopping' | 'pick' | 'recipes' | 'profile';
type RecipeTab = 'all' | 'available' | 'mine' | 'likes' | 'planned';
type ShoppingFilter = 'all' | ItemCategory;
type FridgeStatusFilter = 'all' | 'expired' | 'soon' | 'no-expiry';
type FridgeSort = 'newest' | 'oldest' | 'expiry' | 'name';
type ShoppingSort = 'newest' | 'oldest' | 'name' | 'status';
type AuthMode = 'login' | 'register';
type ProfileSection =
  'menu' | 'subscription' | 'household' | 'notifications' | 'support' | 'feedback' | 'about';
type DevSection =
  | 'overview'
  | 'users'
  | 'usage'
  | 'support'
  | 'feedback'
  | 'events'
  | 'infra'
  | 'recipes';

interface OnboardingStep {
  tab: TabId;
  label: string;
  title: string;
  body: string;
  action: string;
  kind?: 'notifications';
}

interface Recipe {
  mealTypes?: RecipeMealType[];
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
  ingredients?: string[];
  preparationMinutes?: number | null;
  usedIngredients?: string[];
  missedIngredients?: string[];
  expiringIngredientCount?: number;
  matchPercent?: number;
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
  expiringIngredientCount?: number;
}

interface SwipeState {
  id: string;
  startX: number;
  startY: number;
  touchId: number | null;
  deltaX: number;
  axis: 'horizontal' | 'vertical' | null;
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

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    tab: 'fridge',
    label: 'Шаг 1 из 6',
    title: 'Начните с того, что уже есть дома',
    body: 'Добавляйте продукты, бытовую химию или лекарства. Указывайте количество и срок годности там, где он важен.',
    action: 'Далее',
  },
  {
    tab: 'shopping',
    label: 'Шаг 2 из 6',
    title: 'Покупки собираются в один список',
    body: 'Свайпните карточку в запасах вправо, чтобы перенести товар в покупки, или влево, чтобы удалить. Доведите свайп до появления яркой иконки и отпустите: действие выполнится сразу, без нажатия. Для редактирования нажмите три точки.',
    action: 'Далее',
  },
  {
    tab: 'pick',
    label: 'Шаг 3 из 6',
    title: 'Бросьте кубик — выберите, что приготовить',
    body: 'Выберите, что хотите приготовить: завтрак, обед, ужин или десерт. Используйте запасы или включите «Докупить всё» — даже если холодильник пуст. Бросьте кубик и получите подходящий рецепт.',
    action: 'Показать рецепты',
  },
  {
    tab: 'recipes',
    label: 'Шаг 4 из 6',
    title: 'Рецепты сохраняют удачные идеи',
    body: 'Здесь собраны рецепты из базы, избранное и рецепты вашего дома. Добавляйте свои рецепты. Зелёным отмечено, что уже есть, красным — что нужно докупить.',
    action: 'Показать профиль',
  },
  {
    tab: 'profile',
    label: 'Шаг 5 из 6',
    title: 'В профиле настраивается общий дом',
    body: 'Переименуйте группу и пригласите участника по email, чтобы вести общий холодильник и список покупок.',
    action: 'Настроить уведомления',
  },
  {
    tab: 'profile',
    label: 'Шаг 6 из 6',
    title: 'Включите уведомления',
    body: 'Homie сообщит, когда подходит срок годности и когда участник семьи добавляет или убирает товар из списка покупок.',
    action: 'Включить уведомления',
    kind: 'notifications',
  },
];

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, LoadMoreDirective, LiveUpdateComponent, IconComponent, BarcodeAddComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy, OnInit {
  protected readonly liveUpdate = inject(LiveUpdateService);
  protected readonly nativeOAuth = inject(NativeOAuthService);
  private readonly api = inject(ApiService);
  private readonly injector = inject(Injector);
  private randomTimer: number | null = null;
  private randomRequestId = 0;
  private previousRandomRecipeId: string | null = null;
  private recipeMatchesPending: Promise<boolean> | null = null;
  private recipeMatchesKey = '';
  private toastTimer: number | null = null;
  private refreshTimer: number | null = null;
  protected readonly accountDeletionPage = new URLSearchParams(window.location.search).has(
    'delete-account',
  );

  protected readonly tabs: { id: TabId; label: string; icon: IconName }[] = [
    { id: 'fridge', label: 'Запасы', icon: 'home' },
    { id: 'shopping', label: 'Покупки', icon: 'cart' },
    { id: 'pick', label: 'Подобрать', icon: 'dice' },
    { id: 'recipes', label: 'Рецепты', icon: 'book' },
    { id: 'profile', label: 'Профиль', icon: 'user' },
  ];
  protected readonly devMenu: { id: DevSection; label: string; icon: string }[] = [
    { id: 'overview', label: 'Обзор', icon: '▦' },
    { id: 'users', label: 'Пользователи', icon: '◉' },
    { id: 'usage', label: 'Использование', icon: '↗' },
    { id: 'support', label: 'Поддержка', icon: '?' },
    { id: 'feedback', label: 'Фидбек', icon: '✦' },
    { id: 'events', label: 'События', icon: '!' },
    { id: 'infra', label: 'Состояние данных', icon: '⌁' },
    { id: 'recipes', label: 'Рецепты и переводы', icon: 'SP' },
  ];

  protected readonly units: Unit[] = ['шт.', 'г', 'кг', 'мг', 'мл', 'л', 'упак.', 'бан.', 'бут.'];
  protected readonly activeTab = signal<TabId>('fridge');
  protected readonly activeCategory = signal<ItemCategory>('products');
  protected readonly activeShoppingFilter = signal<ShoppingFilter>('all');
  protected readonly fridgeSearch = signal('');
  protected readonly fridgeStatusFilter = signal<FridgeStatusFilter>('all');
  protected readonly fridgeSort = signal<FridgeSort>('newest');
  protected readonly shoppingSearch = signal('');
  protected readonly shoppingSort = signal<ShoppingSort>('newest');
  protected readonly activeRecipeTab = signal<RecipeTab>('all');
  protected readonly recipeSearch = signal('');
  protected readonly catalogIds = signal<string[] | null>(null);
  protected readonly catalogNextOffset = signal<number | null>(null);
  protected readonly catalogLimited = signal(false);
  protected readonly catalogLoadFailed = signal(false);
  private catalogSource: 'auto' | 'local' | 'remote' = 'auto';
  private catalogRequest = 0;
  private recipeSearchTimer: number | null = null;

  protected readonly pickMode = signal<RecipePickMode>('available');
  protected readonly mealTypeOptions = RECIPE_MEAL_TYPES;
  protected readonly pickMealType = signal<RecipeMealType | 'all'>('all');
  protected readonly pickSource = signal<RecipePickSource>('all');
  protected readonly maximumMissing = signal(2);
  protected readonly randomBusy = signal(false);
  protected readonly randomRolling = signal(false);
  protected readonly randomResultOpen = signal(false);
  private readonly randomResultDialog =
    viewChild<ElementRef<HTMLDialogElement>>('randomResultDialog');
  protected readonly randomError = signal('');
  protected readonly randomRecipeId = signal<string | null>(null);
  protected readonly randomRecipe = computed(
    () => this.recipes().find((recipe) => recipe.id === this.randomRecipeId()) ?? null,
  );
  protected readonly pickCandidates = computed(() =>
    eligibleRecipes(
      this.recipes(),
      this.pickMode(),
      this.pickSource(),
      this.maximumMissing(),
      this.pickMealType(),
    ),
  );
  protected readonly recipeEditorOpen = signal(false);
  protected readonly recipeEditorId = signal<string | null>(null);
  protected readonly recipeEditorError = signal('');
  protected readonly recipeForm = {
    mealTypes: [] as RecipeMealType[],
    title: '',
    description: '',
    imageUrl: '',
    ingredients: '',
    instructions: '',
    preparationMinutes: null as number | null,
  };
  protected readonly profileSection = signal<ProfileSection>('menu');
  protected readonly fridgeAddOpen = signal(false);
  protected readonly barcodeTarget = signal<'fridge' | 'shopping' | null>(null);
  protected readonly fridgeMenuItem = signal<FridgeItem | null>(null);
  protected readonly shoppingMenuItem = signal<ShoppingItem | null>(null);
  protected readonly activeRecipe = signal<Recipe | null>(null);
  protected readonly recipeSuggestionsLoading = signal(false);
  protected readonly recipeSuggestionsError = signal('');
  protected readonly recipeMatchesError = signal('');
  protected readonly recipeMatchesLoading = signal(false);
  protected readonly dishesLoading = signal(false);
  protected readonly dishesError = signal('');
  protected readonly planningDish = signal<{ id: string; title: string } | null>(null);
  protected readonly toastMessage = signal('');
  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly mealPlanForm = {
    date: this.today,
    mealType: 'dinner' as MealType,
  };

  protected readonly newFridgeItem = {
    name: '',
    quantity: 1,
    unit: 'шт.' as Unit,
    expiresAt: this.addDays(5),
    noExpiry: false,
    reminderDays: 1,
    autoAddToShopping: false,
  };

  protected readonly fridgeMenuForm = {
    name: '',
    quantity: 1,
    unit: 'шт.' as Unit,
    expiresAt: '',
    noExpiry: false,
    reminderDays: 1,
    autoAddToShopping: false,
  };
  protected readonly shoppingMenuForm = {
    name: '',
    quantity: 1,
    unit: 'шт.' as Unit,
    category: 'products' as ItemCategory,
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
  protected readonly accountDeletionComplete = signal(false);
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
  protected readonly mealPlan = signal<MealPlanEntry[]>([]);
  protected readonly groupName = signal('');
  protected readonly memberEmail = signal('');
  protected readonly notifications = signal<AppNotification[]>([]);
  protected readonly notificationPreferences = signal<NotificationPreferences>({
    notifyExpiry: true,
    notifyShopping: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
  });
  protected readonly unreadNotifications = signal(0);
  protected readonly notificationsOpen = signal(false);
  protected readonly notificationsEnabled = signal(
    this.load<boolean>(STORAGE_KEYS.notificationsEnabled, false),
  );
  protected readonly pushPermission = signal<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  protected readonly pushBusy = signal(false);
  protected readonly clearedNotificationIds = signal<string[]>([]);
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
  protected readonly devUsers = signal<DevUser[]>([]);
  protected readonly devTickets = signal<SupportTicket[]>([]);
  protected readonly devFeedback = signal<FeedbackItem[]>([]);
  protected readonly devRecipes = signal<DevRecipe[]>([]);
  protected readonly devProducts = signal<DevProduct[]>([]);
  protected readonly devCatalogKind = signal<'recipes' | 'products'>('recipes');
  protected readonly devCatalogNext = signal<number | null>(null);
  protected readonly devCatalogTotal = signal(0);
  protected readonly devCatalogLoading = signal(false);
  protected readonly devCatalogError = signal('');
  protected devCatalogSearch = '';
  private devCatalogRequest = 0;
  protected readonly devTranslationRecipe = signal<DevRecipe | null>(null);
  protected readonly devTranslationProduct = signal<DevProduct | null>(null);
  protected readonly devTranslationSaving = signal(false);
  protected readonly devTranslationError = signal('');
  protected readonly devTranslationForm = {
    mealTypes: [] as RecipeMealType[],
    title: '',
    description: '',
    instructions: '',
    productName: '',
  };

  protected readonly activeDevTicket = signal<SupportTicket | null>(null);
  protected readonly devMessages = signal<SupportMessage[]>([]);
  protected readonly devReply = signal('');
  protected readonly activeDevSection = signal<DevSection>('overview');
  protected readonly hasDevAccess = computed(() => {
    const user = this.currentUser();
    return user?.isAdmin === true;
  });
  protected readonly activeDevSectionLabel = computed(
    () =>
      this.devMenu.find((item) => item.id === this.activeDevSection())?.label ??
      'Оперативная панель',
  );
  protected readonly devLastUpdated = signal('');
  protected readonly devDataError = signal('');
  protected readonly devDataLoading = signal(false);
  protected readonly devTicketFilter = signal<'all' | 'open' | 'unanswered' | 'closed'>('open');
  protected readonly devTicketNextOffset = signal<number | null>(null);
  private devTicketPages = 1;
  private devDataRequest = 0;
  private devNextRefreshAt = 0;
  protected readonly devUnansweredTickets = computed(
    () => this.devSummary()?.support.unansweredTickets ?? 0,
  );
  protected readonly devFeatureRows = computed(() => {
    const summary = this.devSummary();
    const rows = [
      { label: 'Пользователи', count: summary?.users.total ?? 0 },
      { label: 'Дома', count: summary?.households.total ?? 0 },
      { label: 'Продукты дома', count: summary?.usage.fridgeProducts ?? 0 },
      { label: 'Бытовая химия дома', count: summary?.usage.fridgeHousehold ?? 0 },
      { label: 'Покупки', count: summary?.usage.shoppingItems ?? 0 },
      { label: 'Открытые обращения', count: summary?.support.openTickets ?? 0 },
      { label: 'Открытый фидбек', count: summary?.support.openFeedback ?? 0 },
    ];
    const max = Math.max(...rows.map((row) => row.count), 1);
    return rows.map((row) => ({ ...row, width: `${(row.count / max) * 100}%` }));
  });
  protected readonly devActivityMax = computed(() => {
    const days = this.devSummary()?.activity.days ?? [];
    return Math.max(
      ...days.flatMap((day) => [day.users, day.supportTickets, day.feedback]),
      1,
    );
  });
  protected readonly fridgeItems = signal<FridgeItem[]>([]);
  protected readonly shoppingItems = signal<ShoppingItem[]>([]);
  protected readonly recipes = signal<Recipe[]>([]);
  protected readonly recipeDishIdeas = signal<DishIdea[]>([]);
  protected readonly userDishIdeas = signal<DishIdea[]>([]);

  protected readonly visibleFridgeItems = computed(() => {
    const search = this.normalizeSearch(this.fridgeSearch());
    const filter = this.fridgeStatusFilter();
    const sort = this.fridgeSort();
    return this.fridgeItems()
      .filter((item) => item.category === this.activeCategory())
      .filter((item) => !search || this.normalizeSearch(item.name).includes(search))
      .filter((item) => {
        if (filter === 'expired')
          return Boolean(item.expiresAt && this.daysUntil(item.expiresAt) < 0);
        if (filter === 'soon') {
          return Boolean(
            item.expiresAt &&
            this.daysUntil(item.expiresAt) >= 0 &&
            this.daysUntil(item.expiresAt) <= item.reminderDays,
          );
        }
        if (filter === 'no-expiry') return !item.expiresAt;
        return true;
      })
      .sort((left, right) => this.compareFridgeItems(left, right, sort));
  });
  protected readonly fridgeFiltersActive = computed(
    () => Boolean(this.fridgeSearch().trim()) || this.fridgeStatusFilter() !== 'all',
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
    const category = this.activeShoppingFilter();
    const search = this.normalizeSearch(this.shoppingSearch());
    const sort = this.shoppingSort();
    return this.shoppingItems()
      .filter((item) => category === 'all' || item.category === category)
      .filter((item) => !search || this.normalizeSearch(item.name).includes(search))
      .sort((left, right) => this.compareShoppingItems(left, right, sort));
  });
  protected readonly shoppingFiltersActive = computed(() => Boolean(this.shoppingSearch().trim()));
  protected readonly shoppingSearchPlaceholder = computed(() => {
    const category = this.activeShoppingFilter();
    return category === 'all'
      ? 'Искать во всех покупках'
      : `Искать в разделе «${this.categoryLabel(category)}»`;
  });
  protected readonly shoppingProductsCount = computed(
    () => this.shoppingItems().filter((item) => item.category === 'products').length,
  );
  protected readonly shoppingHouseholdCount = computed(
    () => this.shoppingItems().filter((item) => item.category === 'household').length,
  );
  protected readonly shoppingMedicineCount = computed(
    () => this.shoppingItems().filter((item) => item.category === 'medicine').length,
  );
  protected readonly hasCompletedShoppingItems = computed(() =>
    this.shoppingItems().some((item) => item.checked),
  );
  protected readonly groupMembers = computed(() => this.household()?.members ?? []);
  protected readonly hasPlus = computed(() => this.household()?.subscription?.isPlus ?? false);
  protected readonly subscriptionSource = computed(() => {
    const provider = this.household()?.subscription?.provider;
    if (provider === 'admin') return 'Тестовый доступ команды Homie';
    if (provider === 'rustore') return 'Подписка RuStore';
    if (provider === 'google_play') return 'Подписка Google Play';
    if (provider === 'app_store') return 'Подписка App Store';
    if (provider === 'web') return 'Подписка на сайте';
    return 'Бесплатный тариф';
  });
  protected readonly groupTitle = computed(() => this.household()?.name || 'Моя группа');
  protected readonly groupSummary = computed(() => {
    const count = this.groupMembers().length;
    if (count <= 1) {
      return 'Пока только вы. Добавьте участника по email, чтобы вести общий холодильник.';
    }
    return `${count} участника ведут общий холодильник и список покупок.`;
  });
  protected readonly hasNotifications = computed(() => this.notifications().length > 0);
  protected readonly onboardingIsNotificationStep = computed(
    () => this.onboardingStep().kind === 'notifications',
  );
  protected readonly pushSupported = computed(() => this.browserSupportsPush());
  protected readonly notificationStatusText = computed(() => {
    if (this.isIosDevice() && !this.isStandaloneWebApp()) {
      return 'Сначала добавьте Homie на экран «Домой»';
    }
    if (!this.pushSupported()) return 'Не поддерживаются на этом устройстве';
    if (this.pushPermission() === 'denied') return 'Запрещены в настройках устройства';
    return this.notificationsEnabled() ? 'Включены' : 'Выключены';
  });
  protected readonly activeTabLabel = computed(() => {
    if (this.activeTab() === 'fridge') {
      return this.categoryLabel(this.activeCategory());
    }
    return this.tabs.find((tab) => tab.id === this.activeTab())?.label ?? 'Homie';
  });
  protected readonly activeTabSubtitle = computed(() => {
    if (this.activeTab() === 'fridge') {
      return this.activeCategory() === 'products'
        ? 'Сроки, запасы и напоминания'
        : this.activeCategory() === 'medicine'
          ? 'Лекарства, сроки и домашняя аптечка'
          : 'Запасы дома без привязки к сроку годности';
    }
    if (this.activeTab() === 'shopping') {
      return 'Общий список для дома';
    }
    if (this.activeTab() === 'pick') {
      return 'Бросьте кубик — найдите, что приготовить';
    }
    if (this.activeTab() === 'recipes') {
      return 'Сохраняйте любимое и создавайте свое';
    }
    return 'Дом, аккаунт и поддержка';
  });
  protected readonly recipeList = computed(() => {
    const tab = this.activeRecipeTab();
    const search = this.normalizeSearch(this.recipeSearch());
    const ids = this.catalogIds();
    const catalogView = tab === 'all' && ids !== null;
    const byId = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
    const recipes = catalogView
      ? ids.map((id) => byId.get(id)).filter((recipe): recipe is Recipe => !!recipe)
      : this.recipes();
    return recipes
      .filter((recipe) => {
        if (tab === 'mine') return recipe.mine;
        if (tab === 'likes') return recipe.liked;
        if (tab === 'available')
          return (
            (recipe.usedIngredients?.length ?? 0) > 0 && (recipe.missedIngredients?.length ?? 0) <= 2
          );
        return true;
      })
      .sort((a, b) =>
        tab === 'available'
          ? (a.missedIngredients?.length ?? 0) - (b.missedIngredients?.length ?? 0)
          : 0,
      )
      .filter((recipe) => {
        if (!search || catalogView) return true;
        return [
          recipe.title,
          ...(recipe.usedIngredients ?? []),
          ...(recipe.missedIngredients ?? []),
        ].some((value) => this.normalizeSearch(value).includes(search));
      });
  });
  protected readonly mealPlanDays = computed(() =>
    Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${this.today}T12:00:00`);
      date.setDate(date.getDate() + index);
      const value = date.toISOString().slice(0, 10);
      return {
        value,
        weekday: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
        label: date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
        entries: this.mealPlan().filter((entry) => entry.date === value),
      };
    }),
  );

  private readonly swipe = signal<SwipeState | null>(null);
  protected readonly committingSwipe = signal<{ id: string; action: SwipeAction } | null>(null);
  private stateRevision = 0;

  private readonly handleNativeTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      this.cancelSwipe();
      return;
    }
    const id = this.swipeItemIdForTarget(event.target);
    if (id) this.beginTouchSwipe(event, id);
  };
  private readonly handleNativeTouchMove = (event: TouchEvent): void => {
    const id = this.swipe()?.id;
    if (id) this.moveTouchSwipe(event, id);
  };
  private readonly handleNativeTouchEnd = (): void => {
    const id = this.swipe()?.id;
    if (id) this.endSwipe(id);
  };
  private readonly handleNativeTouchCancel = (): void => {
    this.cancelSwipe();
  };

  ngOnInit(): void {
    // Explicit non-passive touchmove allows horizontal gestures to prevent scrolling.
    document.addEventListener('touchstart', this.handleNativeTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener('touchmove', this.handleNativeTouchMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener('touchend', this.handleNativeTouchEnd, {
      capture: true,
      passive: true,
    });
    document.addEventListener('touchcancel', this.handleNativeTouchCancel, {
      capture: true,
      passive: true,
    });
    if (sessionStorage.getItem('eat-it.delete-account.after-oauth') === 'true') {
      sessionStorage.removeItem('eat-it.delete-account.after-oauth');
      window.location.replace('/?delete-account=1');
      return;
    }
    void this.initializeSession().then(() => this.resumeNativeOAuth());
  }

  ngOnDestroy(): void {
    document.removeEventListener('touchstart', this.handleNativeTouchStart, true);
    document.removeEventListener('touchmove', this.handleNativeTouchMove, true);
    document.removeEventListener('touchend', this.handleNativeTouchEnd, true);
    document.removeEventListener('touchcancel', this.handleNativeTouchCancel, true);
    this.stopRealtimeRefresh();
    this.catalogRequest++;
    if (this.recipeSearchTimer !== null) window.clearTimeout(this.recipeSearchTimer);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.cancelRecipeRoll();
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
      await this.acceptAuthentication(response);
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

  protected async startOAuth(provider: 'google' | 'apple'): Promise<void> {
    if (this.saving()) return;
    if (this.nativeOAuth.isNative) {
      await this.completeNativeOAuth(this.nativeOAuth.signIn(provider));
      return;
    }
    if (this.accountDeletionPage) {
      sessionStorage.setItem('eat-it.delete-account.after-oauth', 'true');
    }
    window.location.assign(this.api.oauthUrl(provider));
  }

  private async resumeNativeOAuth(): Promise<void> {
    if (!this.currentUser() && this.nativeOAuth.hasPending()) {
      await this.completeNativeOAuth(this.nativeOAuth.resume());
    }
  }

  private async completeNativeOAuth(result: Promise<AuthResponse | null>): Promise<void> {
    this.saving.set(true);
    this.authError.set('');
    try {
      const response = await result;
      if (response) await this.acceptAuthentication(response);
    } catch (error) {
      const fallback = 'Не удалось завершить вход. Проверьте подключение и попробуйте снова.';
      this.authError.set(
        error instanceof HttpErrorResponse
          ? this.errorMessage(error, fallback)
          : error instanceof Error && error.name === 'Error'
            ? error.message
            : fallback,
      );
    } finally {
      this.saving.set(false);
    }
  }

  private async acceptAuthentication(response: AuthResponse): Promise<void> {
    this.api.setSessionToken(response.token);
    this.currentUser.set(response.user);
    this.loadAccountPreferences(response.user.id);
    this.authForm.password = '';
    if (this.accountDeletionPage) return;
    await this.loadState();
    void this.syncPushState();
    this.openOnboardingIfNeeded(response.user);
    this.startRealtimeRefresh();
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
    const message = this.accountDeletionPage
      ? 'Удалить аккаунт и связанные с ним данные без возможности восстановления?'
      : 'Удалить аккаунт и завершить текущую сессию?';
    if (!window.confirm(message)) {
      return;
    }
    try {
      await firstValueFrom(this.api.deleteAccount());
      this.resetSession();
      this.accountDeletionComplete.set(true);
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось удалить аккаунт.'));
    }
  }

  protected setTab(tab: TabId): void {
    this.activeTab.set(tab);
    if (tab !== 'profile') {
      this.profileSection.set('menu');
    }
    if (tab !== 'pick') this.cancelRecipeRoll();
    if (tab === 'pick') void this.refreshRecipeMatches();
    if (tab === 'recipes') {
      if (this.catalogIds() === null || this.catalogLoadFailed()) void this.loadRecipeCatalog();
      if (this.activeRecipeTab() === 'available') void this.refreshRecipeMatches();
      void Promise.all([this.loadUserDishes(), this.loadMealPlan()]);
    }
  }

  protected async refreshDevAccess(): Promise<void> {
    if (this.loading()) return;
    const userId = this.currentUser()?.id;
    this.loading.set(true);
    this.apiError.set('');
    try {
      const { user } = await firstValueFrom(this.api.me());
      if (this.currentUser()?.id !== userId) return;
      this.currentUser.set(user);
      if (this.hasDevAccess()) {
        await this.loadDevData();
        this.startRealtimeRefresh();
      } else {
        this.showToast('Доступ администратора пока не назначен');
      }
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось проверить доступ.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected setCategory(category: ItemCategory): void {
    this.activeCategory.set(category);
    this.cancelSwipe();
    this.newFridgeItem.noExpiry = category === 'household';
    if (category === 'household') {
      this.newFridgeItem.reminderDays = 0;
    } else if (!this.newFridgeItem.reminderDays) {
      this.newFridgeItem.reminderDays = 1;
    }
  }

  protected clearFridgeFilters(): void {
    this.fridgeSearch.set('');
    this.fridgeStatusFilter.set('all');
  }

  protected clearShoppingFilters(): void {
    this.shoppingSearch.set('');
  }

  protected setShoppingFilter(filter: ShoppingFilter): void {
    this.activeShoppingFilter.set(filter);
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
          autoAddToShopping: this.newFridgeItem.autoAddToShopping,
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
      this.newFridgeItem.autoAddToShopping = false;
      this.fridgeAddOpen.set(false);
    });
  }

  protected acceptBarcodeAddition(result: BarcodeAddition): void {
    if (!this.currentUser()) return;
    this.stateRevision++;
    if (result.target === 'fridge') {
      this.fridgeItems.update((items) => [result.item, ...items]);
      this.activeCategory.set(result.item.category);
    } else {
      this.shoppingItems.update((items) => [result.item, ...items]);
      this.activeShoppingFilter.set('all');
    }
    this.barcodeTarget.set(null);
    this.setTab(result.target);
    if (this.recipes().length) void this.refreshRecipeMatches();
    this.showToast(result.target === 'fridge' ? 'Товар добавлен в запасы' : 'Товар добавлен в покупки');
  }

  protected openFridgeMenu(item: FridgeItem): void {
    this.fridgeMenuItem.set(item);
    Object.assign(this.fridgeMenuForm, {
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      expiresAt: item.expiresAt ?? '',
      noExpiry: !item.expiresAt,
      reminderDays: item.reminderDays,
      autoAddToShopping: item.autoAddToShopping,
    });
  }

  protected closeFridgeMenu(): void {
    this.fridgeMenuItem.set(null);
  }

  protected async saveFridgeMenu(): Promise<void> {
    const item = this.fridgeMenuItem();
    const name = this.fridgeMenuForm.name.trim();
    const quantity = Number(this.fridgeMenuForm.quantity);
    if (!item || !name || !Number.isFinite(quantity) || quantity <= 0) return;
    const expiresAt =
      item.category === 'household' || this.fridgeMenuForm.noExpiry
        ? null
        : this.fridgeMenuForm.expiresAt || null;
    await this.runMutation(async () => {
      const updated = await firstValueFrom(
        this.api.updateFridgeItem(item.id, {
          name,
          quantity,
          unit: this.fridgeMenuForm.unit,
          expiresAt,
          reminderDays: expiresAt ? Number(this.fridgeMenuForm.reminderDays) || 0 : 0,
          autoAddToShopping: this.fridgeMenuForm.autoAddToShopping,
        }),
      );
      this.replaceFridgeItem(updated);
      this.closeFridgeMenu();
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
        : (window
            .prompt(
              'Годен до (ДД.ММ.ГГГГ), оставьте пустым для товара без срока',
              item.expiresAt ? this.formatDate(item.expiresAt) : '',
            )
            ?.trim() ?? '');
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
        this.closeFridgeMenu();
        if (
          item.autoAddToShopping ||
          window.confirm(`«${item.name}» закончился. Добавить в список покупок?`)
        ) {
          const shoppingItem = await firstValueFrom(
            this.api.createShoppingItem({
              name: item.name,
              quantity: item.quantity,
              unit: item.unit,
              category: item.category,
            }),
          );
          this.shoppingItems.update((items) => [shoppingItem, ...items]);
        }
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

  protected openShoppingMenu(item: ShoppingItem): void {
    this.shoppingMenuItem.set(item);
    Object.assign(this.shoppingMenuForm, {
      name: item.name,
      quantity: item.quantity ?? 1,
      unit: this.displayUnit(item.unit),
      category: item.category,
    });
  }

  protected closeShoppingMenu(): void {
    this.shoppingMenuItem.set(null);
  }

  protected async saveShoppingMenu(): Promise<void> {
    const item = this.shoppingMenuItem();
    const name = this.shoppingMenuForm.name.trim();
    const quantity = Number(this.shoppingMenuForm.quantity);
    if (!item || !name || !Number.isFinite(quantity) || quantity <= 0) return;
    await this.runMutation(async () => {
      const updated = await firstValueFrom(
        this.api.updateShoppingItem(item.id, {
          name,
          quantity,
          unit: this.shoppingMenuForm.unit,
          category: this.shoppingMenuForm.category,
        }),
      );
      this.replaceShoppingItem(updated);
      this.closeShoppingMenu();
    });
  }

  protected async deleteShoppingFromMenu(): Promise<void> {
    const item = this.shoppingMenuItem();
    if (!item) return;
    await this.removeShoppingItem(item.id);
    this.closeShoppingMenu();
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
        : (window
            .prompt(
              'Годен до (ДД.ММ.ГГГГ), оставьте пустым для товара без срока',
              this.formatDate(this.addDays(5)),
            )
            ?.trim() ?? '');
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

  protected async toggleNotificationsEnabled(): Promise<void> {
    if (this.pushBusy()) return;
    if (this.notificationsEnabled()) {
      await this.disablePushNotifications();
      return;
    }
    await this.enablePushNotifications();
  }

  protected async updateNotificationPreferences(
    patch: Partial<NotificationPreferences>,
  ): Promise<void> {
    const next = { ...this.notificationPreferences(), ...patch };
    try {
      const saved = await firstValueFrom(this.api.updateNotificationPreferences(next));
      this.notificationPreferences.set(saved);
      this.showToast('Настройки уведомлений сохранены');
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось сохранить настройки уведомлений.'));
    }
  }

  protected async enableNotificationsFromOnboarding(): Promise<void> {
    if (this.notificationsEnabled() || (await this.enablePushNotifications())) {
      this.finishOnboarding();
    }
  }

  protected toggleRecipeLike(id: string): void {
    this.recipes.update((recipes) =>
      recipes.map((recipe) => (recipe.id === id ? { ...recipe, liked: !recipe.liked } : recipe)),
    );
    this.persistRecipes();
  }

  protected recipeIngredientTotal(recipe: Recipe | null | undefined): number {
    return (recipe?.usedIngredients?.length ?? 0) + (recipe?.missedIngredients?.length ?? 0);
  }

  protected recipeAvailability(recipe: Recipe | null | undefined): string {
    if (!this.recipeIngredientTotal(recipe)) return 'Ингредиенты уточняются';
    const missing = recipe?.missedIngredients?.length ?? 0;
    return missing ? `Докупить: ${missing}` : 'Всё есть дома';
  }

  protected changePickSettings(): void {
    this.cancelRecipeRoll();
    this.randomRecipeId.set(null);
    this.randomError.set('');
  }

  protected toggleMealType(types: RecipeMealType[], type: RecipeMealType): RecipeMealType[] {
    return types.includes(type) ? types.filter((item) => item !== type) : [...types, type];
  }

  protected async randomizeRecipe(): Promise<void> {
    if (this.randomBusy()) return;
    this.closeRandomResult();
    this.toastMessage.set('');
    this.apiError.set('');
    this.randomBusy.set(true);
    this.randomError.set('');
    this.randomRecipeId.set(null);
    const requestId = ++this.randomRequestId;
    const refreshed = await this.refreshRecipeMatches();
    if (requestId !== this.randomRequestId) return;
    if (!refreshed) {
      this.randomBusy.set(false);
      this.randomError.set(
        'Не удалось проверить рецепты. Проверьте подключение и попробуйте ещё раз.',
      );
      return;
    }
    const recipe = pickRecipe(this.pickCandidates(), this.previousRandomRecipeId);
    this.randomRecipeId.set(null);
    if (!recipe) {
      this.randomBusy.set(false);
      this.randomError.set('Нет подходящих рецептов. Измените условия или источник рецептов.');
      return;
    }
    this.randomRolling.set(true);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.randomTimer = window.setTimeout(
      () => {
        if (requestId !== this.randomRequestId) return;
        // Stock may have changed while the die was rolling. Do not show an ineligible result.
        if (!this.pickCandidates().some((candidate) => candidate.id === recipe.id)) {
          this.randomError.set('Запасы изменились. Подберите рецепт ещё раз.');
        } else {
          this.randomRecipeId.set(recipe.id);
          this.previousRandomRecipeId = recipe.id;
          this.showRandomResult();
        }
        this.randomRolling.set(false);
        this.randomBusy.set(false);
        this.randomTimer = null;
      },
      reducedMotion ? 0 : 1350,
    );
  }

  protected showRandomResult(): void {
    if (!this.randomRecipe()) return;
    this.randomResultOpen.set(true);
    afterNextRender(
      () => {
        const dialog = this.randomResultDialog()?.nativeElement;
        if (this.randomResultOpen() && dialog && !dialog.open) dialog.showModal();
      },
      { injector: this.injector },
    );
  }

  protected closeRandomResult(): void {
    this.randomResultDialog()?.nativeElement.close();
    this.randomResultOpen.set(false);
  }

  protected openRandomRecipe(): void {
    const recipe = this.randomRecipe();
    this.closeRandomResult();
    if (recipe) void this.openRecipe(recipe);
  }

  private cancelRecipeRoll(): void {
    this.closeRandomResult();
    this.randomRequestId++;
    if (this.randomTimer !== null) window.clearTimeout(this.randomTimer);
    this.randomTimer = null;
    this.randomBusy.set(false);
    this.randomRolling.set(false);
  }

  protected openRecipeEditor(recipe?: Recipe): void {
    if (recipe && !recipe.mine) return;
    this.recipeEditorId.set(recipe?.id ?? null);
    this.recipeEditorError.set('');
    Object.assign(this.recipeForm, {
      mealTypes: [...(recipe?.mealTypes ?? [])],
      title: recipe?.title ?? '',
      description: recipe?.description ?? '',
      imageUrl: recipe?.image ?? '',
      ingredients: (
        recipe?.ingredients ?? [
          ...(recipe?.usedIngredients ?? []),
          ...(recipe?.missedIngredients ?? []),
        ]
      ).join('\n'),
      instructions: (recipe?.instructions ?? []).join('\n'),
      preparationMinutes: recipe?.preparationMinutes ?? null,
    });
    this.activeRecipe.set(null);
    this.recipeEditorOpen.set(true);
  }

  protected closeRecipeEditor(): void {
    if (!this.saving()) this.recipeEditorOpen.set(false);
  }

  protected async saveRecipe(): Promise<void> {
    if (this.saving()) return;
    const ingredients = this.recipeForm.ingredients
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const instructions = this.recipeForm.instructions
      .split(/\n+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!this.recipeForm.title.trim() || !ingredients.length || !instructions.length) {
      this.recipeEditorError.set('Добавьте название, ингредиенты и шаги приготовления.');
      return;
    }
    if (
      ingredients.length > 20 ||
      ingredients.some((value) => value.length > 120) ||
      instructions.length > 30 ||
      instructions.some((value) => value.length > 1000)
    ) {
      this.recipeEditorError.set(
        'До 20 ингредиентов по 120 символов и до 30 шагов по 1000 символов.',
      );
      return;
    }
    this.saving.set(true);
    this.stateRevision++;
    this.recipeEditorError.set('');
    const userId = this.currentUser()?.id;
    const id = this.recipeEditorId();
    const householdId = this.household()?.id;
    const input = {
      title: this.recipeForm.title.trim(),
      mealTypes: this.recipeForm.mealTypes,
      description: this.recipeForm.description.trim(),
      imageUrl: this.recipeForm.imageUrl.trim() || null,
      ingredients,
      instructions,
      preparationMinutes: this.recipeForm.preparationMinutes ?? null,
    };
    try {
      const result = await firstValueFrom(
        id ? this.api.updateRecipe(id, input) : this.api.createDish(input),
      );
      if (this.currentUser()?.id !== userId || this.household()?.id !== householdId) return;
      this.syncUserDishes(result.recipes);
      this.persistRecipes();
      this.recipeEditorOpen.set(false);
      this.showToast(id ? 'Рецепт обновлён' : 'Рецепт добавлен');
    } catch (error) {
      this.recipeEditorError.set(
        this.errorMessage(error, 'Не удалось сохранить рецепт. Проверьте поля и подключение.'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async refreshRecipeMatches(): Promise<boolean> {
    const userId = this.currentUser()?.id;
    const householdId = this.household()?.id;
    const revision = this.stateRevision;
    const stock = JSON.stringify(this.fridgeItems());
    const key = JSON.stringify([userId, householdId, revision, stock]);
    if (this.recipeMatchesPending && this.recipeMatchesKey === key)
      return this.recipeMatchesPending;
    this.recipeMatchesKey = key;
    this.recipeMatchesLoading.set(true);
    const pending = (async () => {
      try {
        const result = await firstValueFrom(this.api.getRecipeMatches());
        if (
          this.currentUser()?.id !== userId ||
          this.household()?.id !== householdId ||
          this.stateRevision !== revision ||
          JSON.stringify(this.fridgeItems()) !== stock
        )
          return false;
        const savedById = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
        this.recipes.set(
          result.recipes.map((recipe) =>
            this.toRecipe(recipe, savedById.get(recipe.id), recipe.source === 'user'),
          ),
        );
        this.updateActiveRecipe();
        this.recipeMatchesError.set('');
        return true;
      } catch {
        if (this.currentUser()?.id === userId && this.household()?.id === householdId) {
          this.recipeMatchesError.set(
            'Не удалось обновить наличие ингредиентов. Проверьте подключение.',
          );
        }
        return false;
      }
    })();
    this.recipeMatchesPending = pending;
    try {
      return await pending;
    } finally {
      if (this.recipeMatchesPending === pending) {
        this.recipeMatchesPending = null;
        this.recipeMatchesLoading.set(false);
      }
    }
  }

  private updateActiveRecipe(): void {
    const active = this.activeRecipe();
    if (active)
      this.activeRecipe.set(this.recipes().find((recipe) => recipe.id === active.id) ?? null);
  }

  protected async openRecipe(recipe: Recipe): Promise<void> {
    this.activeRecipe.set(recipe);
    if (recipe.mine || recipe.instructions?.length) return;
    try {
      const result = await firstValueFrom(this.api.getRecipeDetails(recipe.id));
      if (result.recipe) {
        this.activeRecipe.update((current) =>
          current?.id === recipe.id
            ? {
                ...current,
                time: result.recipe?.subtitle ?? current.time,
                description: result.recipe?.description ?? current.description,
                instructions: result.recipe?.instructions ?? current.instructions,
                image: result.recipe?.image ?? current.image,
              }
            : current,
        );
      }
    } catch {
      // The summary remains available if the optional details request fails.
    }
  }

  protected closeRecipe(): void {
    this.activeRecipe.set(null);
  }

  protected async addMissingIngredientsToShopping(
    id: string | undefined,
    missingIngredients: string[] | undefined,
  ): Promise<void> {
    if (!id || !missingIngredients?.length || this.saving()) {
      return;
    }

    await this.runMutation(async () => {
      const result = await firstValueFrom(this.api.addRecipeIngredientsToShopping(id));
      this.shoppingItems.update((items) => {
        const existingIds = new Set(items.map((item) => item.id));
        return [...result.items.filter((item) => !existingIds.has(item.id)), ...items];
      });
      this.showToast(
        result.addedCount > 0
          ? `Добавлено в покупки: ${result.addedCount}`
          : 'Все недостающие продукты уже в покупках',
      );
    });
  }

  protected async deleteUserDish(id: string | undefined): Promise<void> {
    if (!id || this.saving() || !window.confirm('Удалить ваш рецепт?')) {
      return;
    }

    await this.runMutation(async () => {
      await firstValueFrom(this.api.deleteDish(id));
      this.userDishIdeas.update((dishes) => dishes.filter((dish) => dish.id !== id));
      this.recipes.update((recipes) => recipes.filter((recipe) => recipe.id !== id));
      this.mealPlan.update((entries) => entries.filter((entry) => entry.dish.id !== id));
      if (this.activeRecipe()?.id === id) this.activeRecipe.set(null);
      this.persistRecipes();
      this.showToast('Рецепт удален');
    });
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

  protected defaultRecipeImage(): string {
    return 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=800&q=80';
  }

  protected recipeImage(title?: string | null, image?: string | null): string {
    if (image) {
      return image;
    }
    const images: Record<string, string> = {
      'Омлет с сыром':
        'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80',
      'Паста с овощами':
        'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=80',
      Сырники:
        'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=800&q=80',
      'Рис с курицей':
        'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=800&q=80',
    };
    return images[title ?? ''] ?? this.defaultRecipeImage();
  }

  protected useRecipeImageFallback(event: Event): void {
    const image = event.target as HTMLImageElement;
    const fallback = this.defaultRecipeImage();
    if (image.src !== fallback) {
      image.src = fallback;
    }
  }

  protected showSavedRecipes(): void {
    this.activeRecipeTab.set('likes');
    void this.refreshRecipeMatches();
  }

  protected selectRecipeTab(tab: RecipeTab): void {
    this.activeRecipeTab.set(tab);
    if (tab === 'available') void this.refreshRecipeMatches();
    if (tab === 'all' && this.catalogIds() === null) void this.loadRecipeCatalog();
  }

  protected setRecipeSearch(value: string): void {
    this.recipeSearch.set(value);
    if (this.recipeSearchTimer !== null) window.clearTimeout(this.recipeSearchTimer);
    this.catalogRequest++;
    this.catalogIds.set([]);
    this.catalogNextOffset.set(null);
    this.catalogLoadFailed.set(false);
    this.recipeSuggestionsError.set('');
    if (this.activeRecipeTab() === 'available') {
      this.recipeSearchTimer = null;
      this.catalogIds.set(null);
      this.recipeSuggestionsLoading.set(false);
      return;
    }
    this.recipeSuggestionsLoading.set(true);
    this.recipeSearchTimer = window.setTimeout(() => {
      this.recipeSearchTimer = null;
      void this.loadRecipeCatalog();
    }, 350);
  }

  protected async loadMoreRecipes(): Promise<void> {
    if (this.catalogNextOffset() === null || this.recipeSuggestionsLoading()) return;
    await this.loadRecipeCatalog(false);
  }

  protected async loadRecipeCatalog(reset = true): Promise<void> {
    if (!reset && this.recipeSuggestionsLoading()) return;
    if (this.recipeSearchTimer !== null) window.clearTimeout(this.recipeSearchTimer);
    this.recipeSearchTimer = null;
    if (reset) {
      this.catalogIds.set([]);
      this.catalogNextOffset.set(null);
      this.catalogLimited.set(false);
      this.catalogSource = 'auto';
    }
    const request = ++this.catalogRequest;
    const offset = reset ? 0 : this.catalogNextOffset();
    if (offset === null) return;
    this.recipeSuggestionsLoading.set(true);
    this.catalogLoadFailed.set(false);
    this.recipeSuggestionsError.set('');
    const userId = this.currentUser()?.id;
    const householdId = this.household()?.id;
    const revision = this.stateRevision;
    const stock = JSON.stringify(this.fridgeItems());
    const isCurrent = () =>
      request === this.catalogRequest &&
      this.currentUser()?.id === userId &&
      this.household()?.id === householdId;
    try {
      const result = await firstValueFrom(
        this.api.getRecipes(this.recipeSearch().trim(), offset, this.catalogSource),
      );
      if (!isCurrent()) return;
      this.catalogSource = result.source ?? 'auto';
      this.catalogNextOffset.set(result.nextOffset ?? null);
      this.catalogLimited.set(result.limited ?? false);
      this.catalogIds.update((ids) => [
        ...new Set([...(ids ?? []), ...result.recipes.map((recipe) => recipe.id)]),
      ]);
      this.recipeSuggestionsError.set(result.warning ?? '');
      if (revision !== this.stateRevision || stock !== JSON.stringify(this.fridgeItems())) {
        await this.refreshRecipeMatches();
        return;
      }
      const savedById = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
      for (const recipe of result.recipes)
        savedById.set(recipe.id, this.toRecipe(recipe, savedById.get(recipe.id)));
      this.recipes.set([...savedById.values()]);
      this.updateActiveRecipe();
    } catch (error) {
      if (!isCurrent()) return;
      this.catalogLoadFailed.set(true);
      this.recipeSuggestionsError.set(
        this.errorMessage(error, 'Не удалось загрузить рецепты. Повторите попытку.'),
      );
    } finally {
      if (isCurrent()) this.recipeSuggestionsLoading.set(false);
    }
  }

  protected async loadRecipeSuggestions(): Promise<void> {
    if (this.recipeSuggestionsLoading()) {
      return;
    }

    this.recipeSuggestionsLoading.set(true);
    this.recipeSuggestionsError.set('');
    const userId = this.currentUser()?.id;
    try {
      const result = await firstValueFrom(this.api.getRecipeSuggestions());
      if (this.currentUser()?.id !== userId) return;
      const savedById = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
      this.recipeDishIdeas.set(
        result.recipes.length ? result.recipes.map((recipe) => this.toDishIdea(recipe)) : [],
      );
      this.recipes.update((recipes) => [
        ...recipes.filter((recipe) => recipe.mine),
        ...result.recipes.map((recipe) => this.toRecipe(recipe, savedById.get(recipe.id))),
      ]);
      this.updateActiveRecipe();
    } catch (error) {
      this.recipeSuggestionsError.set(this.errorMessage(error, 'Не удалось загрузить рецепты.'));
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
    const userId = this.currentUser()?.id;
    const revision = this.stateRevision;
    const householdId = this.household()?.id;
    const stock = JSON.stringify(this.fridgeItems());
    try {
      const result = await firstValueFrom(this.api.getDishes());
      if (this.currentUser()?.id !== userId) return;
      if (
        householdId !== this.household()?.id ||
        revision !== this.stateRevision ||
        stock !== JSON.stringify(this.fridgeItems())
      ) {
        await this.refreshRecipeMatches();
        return;
      }
      this.syncUserDishes(result.recipes);
    } catch (error) {
      this.dishesError.set(this.errorMessage(error, 'Не удалось загрузить свои рецепты.'));
      this.userDishIdeas.set([]);
    } finally {
      this.dishesLoading.set(false);
    }
  }

  protected async loadMealPlan(): Promise<void> {
    if (!this.hasPlus()) {
      this.mealPlan.set([]);
      return;
    }
    const userId = this.currentUser()?.id;
    try {
      const result = await firstValueFrom(this.api.getMealPlan());
      if (this.currentUser()?.id !== userId) return;
      this.mealPlan.set(result.entries);
    } catch (error) {
      this.dishesError.set(this.errorMessage(error, 'Не удалось загрузить недельное меню.'));
    }
  }

  protected openMealPlanner(dish: { id?: string; title: string }): void {
    if (!this.hasPlus()) {
      this.activeRecipe.set(null);
      this.activeTab.set('profile');
      this.profileSection.set('subscription');
      return;
    }
    if (!dish.id) return;
    this.mealPlanForm.date = this.today;
    this.mealPlanForm.mealType = 'dinner';
    this.planningDish.set({ id: dish.id, title: dish.title });
  }

  protected closeMealPlanner(): void {
    this.planningDish.set(null);
  }

  protected async savePlannedMeal(): Promise<void> {
    const dish = this.planningDish();
    if (!dish || this.saving()) return;

    await this.runMutation(async () => {
      const entry = await firstValueFrom(
        this.api.planMeal({
          dishId: dish.id,
          date: this.mealPlanForm.date,
          mealType: this.mealPlanForm.mealType,
        }),
      );
      this.mealPlan.update((entries) =>
        [
          ...entries.filter((item) => item.date !== entry.date || item.mealType !== entry.mealType),
          entry,
        ].sort((left, right) => left.date.localeCompare(right.date)),
      );
      this.planningDish.set(null);
      this.showToast('Блюдо добавлено в недельное меню');
    });
  }

  protected async deletePlannedMeal(entry: MealPlanEntry): Promise<void> {
    await this.runMutation(async () => {
      await firstValueFrom(this.api.deletePlannedMeal(entry.id));
      this.mealPlan.update((entries) => entries.filter((item) => item.id !== entry.id));
      this.showToast('Блюдо убрано из меню');
    });
  }

  protected mealTypeLabel(mealType: MealType): string {
    if (mealType === 'breakfast') return 'Завтрак';
    if (mealType === 'lunch') return 'Обед';
    return 'Ужин';
  }

  private syncUserDishes(recipes: RecipeSuggestion[]): void {
    const savedById = new Map(this.recipes().map((recipe) => [recipe.id, recipe]));
    this.userDishIdeas.set(recipes.map((recipe) => this.toDishIdea(recipe)));
    this.recipes.update((current) => [
      ...recipes.map((recipe) => this.toRecipe(recipe, savedById.get(recipe.id), true)),
      ...current.filter((recipe) => !recipe.mine),
    ]);
    this.updateActiveRecipe();
    const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    this.mealPlan.update((entries) =>
      entries.map((entry) => {
        const recipe = recipesById.get(entry.dish.id);
        return recipe
          ? {
              ...entry,
              dish: {
                ...entry.dish,
                title: recipe.title,
                image: recipe.image,
                subtitle: recipe.subtitle ?? null,
              },
            }
          : entry;
      }),
    );
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
      expiringIngredientCount: recipe.expiringIngredientCount,
    };
  }

  private toRecipe(recipe: RecipeSuggestion, saved?: Recipe, mine = false): Recipe {
    const isCatalogFallback = recipe.source === 'spoonacular-catalog';
    return {
      mealTypes: recipe.mealTypes ?? [],
      id: recipe.id,
      title: recipe.title,
      time: recipe.subtitle ?? 'Рецепт из базы',
      tags: isCatalogFallback
        ? ['популярное', 'Spoonacular']
        : recipe.missedIngredientCount > 0
          ? [`докупить ${recipe.missedIngredientCount}`, `${recipe.matchPercent}%`]
          : ['все есть', `${recipe.matchPercent}%`],
      liked: saved?.liked ?? false,
      mine,
      image: recipe.image,
      source: recipe.source,
      externalId: recipe.externalId,
      description: recipe.description,
      instructions: recipe.instructions,
      usedIngredients: recipe.usedIngredients,
      missedIngredients: recipe.missedIngredients,
      ingredients: recipe.ingredients,
      preparationMinutes: recipe.preparationMinutes,
      expiringIngredientCount: recipe.expiringIngredientCount,
      matchPercent: recipe.matchPercent,
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
        unread.map((notification) =>
          firstValueFrom(this.api.markNotification(notification.id, true)),
        ),
      );
      const updatedById = new Map(updated.map((notification) => [notification.id, notification]));
      this.notifications.update((items) => items.map((item) => updatedById.get(item.id) ?? item));
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
    const userId = this.currentUser()?.id;
    if (userId) {
      localStorage.setItem(
        `${STORAGE_KEYS.clearedNotifications}.${userId}`,
        JSON.stringify(nextIds),
      );
    }
    this.notifications.set([]);
    this.unreadNotifications.set(0);
    this.showToast('Уведомления очищены');
  }

  protected beginSwipe(event: PointerEvent, id: string): void {
    if (this.saving()) return;
    if (event.pointerType === 'touch') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.swipe.set({
      id,
      startX: event.clientX,
      startY: event.clientY,
      touchId: null,
      deltaX: 0,
      axis: null,
    });
  }

  protected beginTouchSwipe(event: TouchEvent, id: string): void {
    if (this.saving()) return;
    if (event.touches.length !== 1) {
      this.cancelSwipe();
      return;
    }
    const touch = event.touches.item(0);
    if (!touch) return;
    this.swipe.set({
      id,
      startX: touch.clientX,
      startY: touch.clientY,
      touchId: touch.identifier,
      deltaX: 0,
      axis: null,
    });
  }

  protected moveTouchSwipe(event: TouchEvent, id: string): void {
    const swipe = this.swipe();
    if (!swipe || swipe.id !== id) return;
    if (event.touches.length !== 1) {
      this.cancelSwipe();
      return;
    }
    const touch = event.touches.item(0);
    if (!touch || touch.identifier !== swipe.touchId) return;
    const deltaX = touch.clientX - swipe.startX;
    const deltaY = touch.clientY - swipe.startY;
    const axis =
      swipe.axis ??
      (Math.hypot(deltaX, deltaY) > 6
        ? Math.abs(deltaX) > Math.abs(deltaY)
          ? 'horizontal'
          : 'vertical'
        : null);
    if (axis === 'vertical') {
      this.swipe.set({ ...swipe, axis });
      return;
    }
    if (axis !== 'horizontal') return;
    if (event.cancelable) event.preventDefault();
    this.swipe.set({ ...swipe, axis, deltaX: Math.max(-148, Math.min(148, deltaX)) });
  }

  protected moveSwipe(event: PointerEvent, id: string): void {
    if (event.pointerType === 'touch') return;
    const swipe = this.swipe();
    if (!swipe || swipe.id !== id) {
      return;
    }
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    const axis =
      swipe.axis ??
      (Math.hypot(deltaX, deltaY) > 6
        ? Math.abs(deltaX) > Math.abs(deltaY)
          ? 'horizontal'
          : 'vertical'
        : null);
    if (axis !== 'horizontal') {
      if (axis) this.swipe.set({ ...swipe, axis });
      return;
    }
    if (event.cancelable) event.preventDefault();
    this.swipe.set({ ...swipe, axis, deltaX: Math.max(-148, Math.min(148, deltaX)) });
  }

  protected endSwipe(id: string): void {
    const swipe = this.swipe();
    if (!swipe || swipe.id !== id) {
      return;
    }

    const item = this.fridgeItems().find((fridgeItem) => fridgeItem.id === id);
    const deltaX = swipe.axis === 'horizontal' ? swipe.deltaX : 0;
    this.swipe.set(null);

    if (!item || this.saving()) {
      return;
    }

    if (Math.abs(deltaX) >= 80) {
      void this.commitSwipe(item, deltaX > 0 ? 'shopping' : 'delete');
    }
  }

  protected endPointerSwipe(event: PointerEvent, id: string): void {
    // Safari emits both event families; only touchend may finish a touch gesture.
    if (event.pointerType !== 'touch') this.endSwipe(id);
  }

  protected cancelPointerSwipe(event: PointerEvent): void {
    if (event.pointerType !== 'touch') this.cancelSwipe();
  }

  private cancelSwipe(): void {
    this.swipe.set(null);
  }

  protected swipeOffset(id: string): number {
    const swipe = this.swipe();
    if (swipe?.id === id) {
      return swipe.deltaX;
    }
    const openAction = this.committingSwipe();
    if (openAction?.id !== id) {
      return 0;
    }
    return openAction.action === 'shopping' ? 108 : -108;
  }

  protected swipeProgress(id: string): number {
    return Math.min(Math.abs(this.swipeOffset(id)) / 80, 1);
  }

  protected swipeTransform(id: string): string {
    const offset = this.swipeOffset(id);
    const drop = Math.min(Math.abs(offset) * 0.08, 10);
    return `translate3d(${offset}px, ${drop}px, 0) rotate(${offset * 0.025}deg)`;
  }

  protected swipeAction(id: string): SwipeAction | null {
    const swipe = this.swipe();
    if (swipe?.id === id && swipe.axis === 'horizontal' && Math.abs(swipe.deltaX) > 8) {
      return swipe.deltaX > 0 ? 'shopping' : 'delete';
    }
    const openAction = this.committingSwipe();
    return openAction?.id === id ? openAction.action : null;
  }

  protected isSwiping(id: string): boolean {
    const swipe = this.swipe();
    return swipe?.id === id && swipe.axis === 'horizontal';
  }

  private swipeItemIdForTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    if (target.closest('button, input, select, textarea, a')) return null;
    return target.closest<HTMLElement>('.fridge-row[data-swipe-id]')?.dataset['swipeId'] ?? null;
  }

  private async commitSwipe(item: FridgeItem, action: SwipeAction): Promise<void> {
    if (this.saving() || this.committingSwipe()) return;
    this.committingSwipe.set({ id: item.id, action });
    try {
      await this.runMutation(async () => {
        if (action === 'shopping') {
          const shoppingItem = await firstValueFrom(this.api.moveFridgeToShopping(item.id));
          this.shoppingItems.update((items) => [
            shoppingItem,
            ...items.filter((current) => current.id !== shoppingItem.id),
          ]);
        } else {
          await firstValueFrom(this.api.deleteFridgeItem(item.id));
        }
        this.fridgeItems.update((items) => items.filter((current) => current.id !== item.id));
        this.showToast(action === 'shopping' ? 'Перенесено в покупки' : 'Удалено из запасов');
      });
    } finally {
      this.committingSwipe.set(null);
    }
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
    if (category === 'household') {
      return 'Бытовая химия';
    }
    return category === 'medicine' ? 'Аптечка' : 'Продукты';
  }

  protected expiryBadgeLabel(date: string | null): string {
    if (!date) {
      return 'Без срока';
    }
    const days = this.daysUntil(date);
    if (days < 0) {
      return `Просрочен ${Math.abs(days)} дн.`;
    }
    if (days === 0) {
      return 'Сегодня';
    }
    return `Через ${days} дн.`;
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
    if (notification.type === 'shopping_added' || notification.type === 'shopping_removed') {
      return 'Покупки';
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
    if (notification.type === 'shopping_added') {
      return '+';
    }
    if (notification.type === 'shopping_removed') {
      return '−';
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
    return `${(value / this.devActivityMax()) * 100}%`;
  }

  private async loadState(): Promise<void> {
    const userId = this.currentUser()?.id;
    this.loading.set(true);
    this.apiError.set('');
    try {
      const state = await firstValueFrom(this.api.getState());
      if (this.currentUser()?.id !== userId) return;
      const stockChanged = JSON.stringify(this.fridgeItems()) !== JSON.stringify(state.fridgeItems);
      this.fridgeItems.set(state.fridgeItems);
      this.shoppingItems.set(state.shoppingItems);
      this.household.set(state.household);
      this.groupName.set(state.household.name);
      if (stockChanged && this.recipes().length) await this.refreshRecipeMatches();
      await Promise.all([
        this.loadNotifications(),
        this.loadSupportTickets(),
        this.loadMealPlan(),
        this.loadNotificationPreferences(),
      ]);
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

    const revision = this.stateRevision;
    try {
      if (this.devMode()) {
        if (this.hasDevAccess() && Date.now() >= this.devNextRefreshAt) {
          await this.loadDevData();
          this.apiError.set('');
        }
        return;
      }

      const state = await firstValueFrom(this.api.getState());
      // A response started before a mutation must not resurrect a moved/deleted card.
      if (this.saving() || revision !== this.stateRevision) return;
      const stockChanged = JSON.stringify(this.fridgeItems()) !== JSON.stringify(state.fridgeItems);
      this.fridgeItems.set(state.fridgeItems);
      this.shoppingItems.set(state.shoppingItems);
      this.household.set(state.household);
      this.groupName.set(state.household.name);
      if (stockChanged && this.recipes().length) await this.refreshRecipeMatches();
      await Promise.all([this.loadNotifications(), this.loadSupportTickets()]);
      this.apiError.set('');
    } catch {
      // Keep the current UI visible during transient mobile network drops.
    }
  }

  private async loadNotifications(): Promise<void> {
    const userId = this.currentUser()?.id;
    const result = await firstValueFrom(this.api.getNotifications());
    if (this.currentUser()?.id !== userId) return;
    const cleared = new Set(this.clearedNotificationIds());
    const notifications = result.notifications.filter(
      (notification) => !cleared.has(notification.id),
    );
    this.notifications.set(notifications);
    this.unreadNotifications.set(
      notifications.filter((notification) => !notification.readAt).length,
    );
  }

  private async loadNotificationPreferences(): Promise<void> {
    try {
      this.notificationPreferences.set(await firstValueFrom(this.api.getNotificationPreferences()));
    } catch {
      // Keep defaults when an older API is still serving the app during deployment.
    }
  }

  private async loadSupportTickets(): Promise<void> {
    const userId = this.currentUser()?.id;
    const result = await firstValueFrom(this.api.getSupportTickets());
    if (this.currentUser()?.id !== userId) return;
    this.supportTickets.set(result.tickets);
  }

  protected async filterDevTickets(filter: 'all' | 'open' | 'unanswered' | 'closed'): Promise<void> {
    this.devTicketFilter.set(filter);
    this.devTicketPages = 1;
    this.devTickets.set([]);
    this.devTicketNextOffset.set(null);
    await this.loadDevData();
  }

  protected async loadMoreDevTickets(): Promise<void> {
    if (this.devDataLoading() || this.devTicketNextOffset() === null) return;
    this.devTicketPages++;
    await this.loadDevData();
  }

  private async loadDevData(): Promise<void> {
    const userId = this.currentUser()?.id;
    const request = ++this.devDataRequest;
    this.devNextRefreshAt = Date.now() + 30_000;
    this.devDataLoading.set(true);
    try {
      const [summary, ticketPages, feedback, users] = await Promise.all([
        firstValueFrom(this.api.getDevSummary()),
        Promise.all(Array.from({ length: this.devTicketPages }, (_, page) =>
          firstValueFrom(this.api.getDevSupportTickets(this.devTicketFilter(), page * 100)),
        )),
        firstValueFrom(this.api.getDevFeedback()),
        firstValueFrom(this.api.getDevUsers()),
      ]);
      if (this.currentUser()?.id !== userId || request !== this.devDataRequest) return;
      this.devSummary.set(summary);
      this.devTickets.set([...new Map(ticketPages.flatMap((page) => page.tickets)
        .map((ticket) => [ticket.id, ticket])).values()]);
      this.devTicketNextOffset.set(ticketPages.at(-1)?.nextOffset ?? null);
      this.devFeedback.set(feedback.feedback);
      this.devUsers.set(users.users);
      this.devLastUpdated.set(new Date(summary.generatedAt).toLocaleTimeString('ru-RU'));
      this.devDataError.set('');
      if (this.activeDevSection() === 'recipes') await this.loadDevRecipes();
    } catch {
      if (this.currentUser()?.id === userId && request === this.devDataRequest) {
        this.devDataError.set(this.devSummary()
          ? 'Не удалось обновить данные. Показаны последние успешно загруженные значения.'
          : 'Не удалось загрузить показатели. Нажмите «Обновить».');
      }
    } finally {
      if (request === this.devDataRequest) this.devDataLoading.set(false);
    }
  }

  protected async toggleDevUserSubscription(user: DevUser): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.api.updateDevUserSubscription(user.id, !user.subscription.isPlus),
      );
      this.devUsers.update((users) =>
        users.map((item) => (item.id === result.user.id ? result.user : item)),
      );
      if (result.user.householdId === this.household()?.id) {
        this.household.set(result.household);
      }
      this.showToast(result.user.subscription.isPlus ? 'Plus активирован' : 'Plus отключён');
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось изменить подписку.'));
    }
  }

  protected async loadDevRecipes(append = false): Promise<void> {
    if (append && (this.devCatalogLoading() || this.devCatalogNext() === null)) return;
    const userId = this.currentUser()?.id;
    const request = ++this.devCatalogRequest;
    const kind = this.devCatalogKind();
    const offset = append ? this.devCatalogNext()! : 0;
    this.devCatalogLoading.set(true);
    this.devCatalogError.set('');
    try {
      const result =
        kind === 'recipes'
          ? await firstValueFrom(this.api.getDevRecipes(this.devCatalogSearch, offset))
          : await firstValueFrom(this.api.getDevProducts(this.devCatalogSearch, offset));
      if (this.currentUser()?.id !== userId || request !== this.devCatalogRequest) return;
      if ('recipes' in result)
        this.devRecipes.update((items) =>
          append ? [...items, ...result.recipes] : result.recipes,
        );
      else
        this.devProducts.update((items) =>
          append ? [...items, ...result.products] : result.products,
        );
      this.devCatalogNext.set(result.nextOffset ?? null);
      this.devCatalogTotal.set(result.total ?? 0);
    } catch (error) {
      if (request === this.devCatalogRequest)
        this.devCatalogError.set(this.errorMessage(error, 'Не удалось загрузить базу.'));
    } finally {
      if (request === this.devCatalogRequest) this.devCatalogLoading.set(false);
    }
  }

  protected setDevCatalogKind(kind: 'recipes' | 'products'): void {
    this.devCatalogKind.set(kind);
    this.devCatalogSearch = '';
    this.devCatalogNext.set(null);
    void this.loadDevRecipes();
  }

  protected translationLabel(status: TranslationStatus, text: string): string {
    if (status === 'manual') return 'Ручной перевод';
    if (status === 'machine') return 'Машинный перевод';
    return /[а-яё]/i.test(text) ? 'Оригинал на русском' : 'Ожидает перевода';
  }

  protected editDevRecipeTranslation(recipe: DevRecipe): void {
    this.devTranslationRecipe.set(recipe);
    this.devTranslationProduct.set(null);
    this.devTranslationError.set('');
    this.scrollToTranslationEditor();
    Object.assign(this.devTranslationForm, {
      mealTypes: [...(recipe.mealTypes ?? [])],
      title: recipe.title,
      description: recipe.description,
      instructions: recipe.instructions.join('\n'),
    });
  }

  protected editDevProductTranslation(product: DevProduct): void {
    this.devTranslationProduct.set(product);
    this.devTranslationRecipe.set(null);
    this.devTranslationError.set('');
    this.devTranslationForm.productName = product.name;
    this.scrollToTranslationEditor();
  }

  private scrollToTranslationEditor(): void {
    afterNextRender(
      () => document.getElementById('dev-translation-editor')?.scrollIntoView?.({ block: 'start' }),
      { injector: this.injector },
    );
  }

  protected async saveDevTranslation(): Promise<void> {
    if (this.devTranslationSaving()) return;
    const recipe = this.devTranslationRecipe();
    const product = this.devTranslationProduct();
    if (!recipe && !product) return;
    const userId = this.currentUser()?.id;
    this.devTranslationSaving.set(true);
    this.devTranslationError.set('');
    try {
      if (recipe) {
        const result = await firstValueFrom(
          this.api.saveDevRecipeTranslation(recipe.id, {
            title: this.devTranslationForm.title.trim(),
            mealTypes: this.devTranslationForm.mealTypes,
            description: this.devTranslationForm.description.trim(),
            instructions: this.devTranslationForm.instructions
              .split('\n')
              .map((step) => step.trim())
              .filter(Boolean),
          }),
        );
        if (this.currentUser()?.id !== userId) return;
        this.devRecipes.update((items) =>
          items.map((item) => (item.id === result.recipe.id ? result.recipe : item)),
        );
        this.devTranslationRecipe.set(null);
      } else if (product) {
        const result = await firstValueFrom(
          this.api.saveDevProductTranslation(
            product.id,
            this.devTranslationForm.productName.trim(),
          ),
        );
        if (this.currentUser()?.id !== userId) return;
        this.devProducts.update((items) =>
          items.map((item) => (item.id === result.product.id ? result.product : item)),
        );
        this.devRecipes.update((items) =>
          items.map((item) => {
            const products = item.products.map((entry) =>
              entry.id === result.product.id ? result.product : entry,
            );
            return { ...item, products, ingredients: products.map((entry) => entry.name) };
          }),
        );
        this.devTranslationProduct.set(null);
      }
      this.showToast('Ручной перевод сохранён в базе');
    } catch (error) {
      if (this.currentUser()?.id === userId)
        this.devTranslationError.set(this.errorMessage(error, 'Не удалось сохранить перевод.'));
    } finally {
      this.devTranslationSaving.set(false);
    }
  }

  protected recipeSourceLabel(source?: string): string {
    return 'DB';
  }

  protected recipeSourceClass(source?: string): string {
    return 'local';
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

  protected async openDevCenter(): Promise<void> {
    if (!this.hasDevAccess()) return;
    this.devMode.set(true);
    this.loading.set(true);
    this.apiError.set('');
    try {
      await this.loadDevData();
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось загрузить Dev center.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async leaveHousehold(): Promise<void> {
    if (this.saving() || this.groupMembers().length < 2) return;
    if (
      !window.confirm(
        'Выйти из общего дома? Продукты, покупки и рецепты останутся у остальных участников. ' +
          'Для вас будет создан пустой личный дом.',
      )
    ) return;
    this.stateRevision++;
    this.saving.set(true);
    this.apiError.set('');
    try {
      await firstValueFrom(this.api.leaveHousehold());
      // Reload all household-scoped caches and in-flight requests together.
      window.location.reload();
    } catch (error) {
      this.apiError.set(this.errorMessage(error, 'Не удалось выйти из дома. Повторите попытку.'));
      this.saving.set(false);
    }
  }

  private async runMutation(action: () => Promise<void>): Promise<void> {
    if (this.saving()) return;
    this.stateRevision++;
    this.saving.set(true);
    this.apiError.set('');
    try {
      await action();
      if (this.recipes().length) await this.refreshRecipeMatches();
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
        this.loadAccountPreferences(session.value.user.id);
        if (this.accountDeletionPage) {
          return;
        }
        if (this.devMode()) {
          if (this.hasDevAccess()) {
            await this.loadDevData();
            this.startRealtimeRefresh();
          }
          return;
        }
        await this.loadState();
        void this.syncPushState();
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
    this.barcodeTarget.set(null);
    this.stateRevision++;
    this.catalogRequest++;
    if (this.recipeSearchTimer !== null) window.clearTimeout(this.recipeSearchTimer);
    this.recipeSearchTimer = null;
    this.catalogIds.set(null);
    this.catalogNextOffset.set(null);
    this.catalogLimited.set(false);
    this.catalogLoadFailed.set(false);
    this.recipeSuggestionsLoading.set(false);
    this.recipeSearch.set('');
    this.catalogSource = 'auto';
    this.recipeMatchesPending = null;
    this.recipeMatchesLoading.set(false);
    this.recipeMatchesError.set('');
    this.recipes.set([]);
    this.clearedNotificationIds.set([]);
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
    this.devUsers.set([]);
    this.devRecipes.set([]);
    this.devProducts.set([]);
    this.devCatalogRequest++;
    this.devCatalogNext.set(null);
    this.devCatalogSearch = '';
    this.devCatalogError.set('');
    this.devTranslationRecipe.set(null);
    this.devTranslationProduct.set(null);
    this.devTranslationError.set('');
    this.recipeDishIdeas.set([]);
    this.userDishIdeas.set([]);
    this.mealPlan.set([]);
    this.activeRecipe.set(null);
    this.planningDish.set(null);
    this.recipeEditorOpen.set(false);
    this.cancelRecipeRoll();
    this.randomRecipeId.set(null);
    this.previousRandomRecipeId = null;
    this.fridgeAddOpen.set(false);
    this.fridgeMenuItem.set(null);
    this.shoppingMenuItem.set(null);
    this.toastMessage.set('');
    this.cancelSwipe();
    this.devSummary.set(null);
    this.devDataRequest++;
    this.devDataError.set('');
    this.devDataLoading.set(false);
    this.devLastUpdated.set('');
    this.devTicketFilter.set('open');
    this.devTicketNextOffset.set(null);
    this.devTicketPages = 1;
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

  private browserSupportsPush(): boolean {
    return (
      typeof Notification !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
  }

  private isIosDevice(): boolean {
    return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  private isStandaloneWebApp(): boolean {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    );
  }

  private iosHomeScreenRequired(): boolean {
    return this.isIosDevice() && !this.isStandaloneWebApp();
  }

  private async syncPushState(): Promise<void> {
    if (!this.pushSupported()) {
      this.pushPermission.set('unsupported');
      this.setNotificationsEnabled(false);
      return;
    }

    this.pushPermission.set(Notification.permission);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      this.setNotificationsEnabled(Notification.permission === 'granted' && Boolean(subscription));
    } catch {
      this.setNotificationsEnabled(false);
    }
  }

  private async enablePushNotifications(): Promise<boolean> {
    if (this.pushBusy()) return false;
    if (this.iosHomeScreenRequired()) {
      this.showToast('На iPhone сначала добавьте Homie на экран «Домой»');
      return false;
    }
    if (!this.pushSupported()) {
      this.pushPermission.set('unsupported');
      this.showToast('Push-уведомления не поддерживаются на этом устройстве');
      return false;
    }

    this.pushBusy.set(true);
    try {
      const permission = await Notification.requestPermission();
      this.pushPermission.set(permission);
      if (permission !== 'granted') {
        this.setNotificationsEnabled(false);
        this.showToast(
          permission === 'denied'
            ? 'Разрешение заблокировано. Включите уведомления в настройках устройства'
            : 'Уведомления не включены',
        );
        return false;
      }

      const configuration = await firstValueFrom(this.api.getPushConfig());
      if (!configuration.configured || !configuration.publicKey) {
        throw new Error('Push server is not configured');
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.decodeVapidPublicKey(configuration.publicKey),
        }));
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.['p256dh'] || !serialized.keys?.['auth']) {
        throw new Error('Browser returned an incomplete push subscription');
      }
      await firstValueFrom(
        this.api.savePushSubscription({
          endpoint: serialized.endpoint,
          keys: {
            p256dh: serialized.keys['p256dh'],
            auth: serialized.keys['auth'],
          },
        }),
      );
      this.setNotificationsEnabled(true);
      this.showToast('Уведомления включены');
      return true;
    } catch (error) {
      this.setNotificationsEnabled(false);
      this.showToast(
        error instanceof Error && error.message === 'Push server is not configured'
          ? 'Push-уведомления ещё не настроены на сервере'
          : 'Не удалось включить уведомления',
      );
      return false;
    } finally {
      this.pushBusy.set(false);
    }
  }

  private async disablePushNotifications(): Promise<void> {
    if (this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        try {
          await firstValueFrom(this.api.deletePushSubscription(subscription.endpoint));
        } finally {
          await subscription.unsubscribe();
        }
      }
      this.setNotificationsEnabled(false);
      this.showToast('Уведомления выключены');
    } catch {
      this.setNotificationsEnabled(false);
      this.showToast('Уведомления выключены на этом устройстве');
    } finally {
      this.pushBusy.set(false);
    }
  }

  private setNotificationsEnabled(enabled: boolean): void {
    this.notificationsEnabled.set(enabled);
    localStorage.setItem(STORAGE_KEYS.notificationsEnabled, JSON.stringify(enabled));
  }

  private decodeVapidPublicKey(value: string): ArrayBuffer {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes.buffer;
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

  private compareFridgeItems(left: FridgeItem, right: FridgeItem, sort: FridgeSort): number {
    if (sort === 'oldest') return this.timestamp(left.createdAt) - this.timestamp(right.createdAt);
    if (sort === 'expiry') {
      return (
        this.expirySortValue(left).localeCompare(this.expirySortValue(right)) ||
        this.timestamp(right.createdAt) - this.timestamp(left.createdAt)
      );
    }
    if (sort === 'name') return this.compareNames(left.name, right.name);
    return this.timestamp(right.createdAt) - this.timestamp(left.createdAt);
  }

  private compareShoppingItems(
    left: ShoppingItem,
    right: ShoppingItem,
    sort: ShoppingSort,
  ): number {
    if (sort === 'oldest') return this.timestamp(left.createdAt) - this.timestamp(right.createdAt);
    if (sort === 'name') return this.compareNames(left.name, right.name);
    if (sort === 'status') {
      return (
        Number(left.checked) - Number(right.checked) ||
        this.timestamp(right.createdAt) - this.timestamp(left.createdAt)
      );
    }
    return this.timestamp(right.createdAt) - this.timestamp(left.createdAt);
  }

  private normalizeSearch(value: string): string {
    return value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  }

  private compareNames(left: string, right: string): number {
    return left.localeCompare(right, 'ru-RU', { sensitivity: 'base' });
  }

  private timestamp(value: string | null | undefined): number {
    const timestamp = Date.parse(value ?? '');
    return Number.isFinite(timestamp) ? timestamp : 0;
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
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  private loadAccountPreferences(userId: string): void {
    this.recipes.set(
      this.load<Recipe[]>(`${STORAGE_KEYS.recipes}.${userId}`, []).filter(
        (recipe) =>
          recipe &&
          typeof recipe.id === 'string' &&
          typeof recipe.title === 'string' &&
          !LEGACY_DEMO_RECIPE_TITLES.has(recipe.title),
      ),
    );
    this.clearedNotificationIds.set(
      this.load<string[]>(`${STORAGE_KEYS.clearedNotifications}.${userId}`, []).filter(
        (id) => typeof id === 'string',
      ),
    );
  }

  private persistRecipes(): void {
    const userId = this.currentUser()?.id;
    if (userId)
      localStorage.setItem(`${STORAGE_KEYS.recipes}.${userId}`, JSON.stringify(this.recipes()));
  }

  private showToast(message: string): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastMessage.set(message);
    this.toastTimer = window.setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set('');
      }
    }, 2500);
  }
}
