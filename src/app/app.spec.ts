import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { ApiService } from './core/api.service';

describe('App', () => {
  let apiService: {
    clearSessionToken?: ReturnType<typeof vi.fn>;
    me: ReturnType<typeof vi.fn>;
    getAuthProviders: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    createFridgeItem: ReturnType<typeof vi.fn>;
    consumeFridgeItem: ReturnType<typeof vi.fn>;
    createShoppingItem: ReturnType<typeof vi.fn>;
    addRecipeIngredientsToShopping: ReturnType<typeof vi.fn>;
    deleteDish: ReturnType<typeof vi.fn>;
    moveFridgeToShopping: ReturnType<typeof vi.fn>;
    deleteFridgeItem: ReturnType<typeof vi.fn>;
    getNotifications: ReturnType<typeof vi.fn>;
    getSupportTickets: ReturnType<typeof vi.fn>;
    getRecipeMatches: ReturnType<typeof vi.fn>;
    createDish: ReturnType<typeof vi.fn>;
    updateRecipe: ReturnType<typeof vi.fn>;
    getRecipes: ReturnType<typeof vi.fn>;
    getDishes: ReturnType<typeof vi.fn>;
    saveDevRecipeTranslation: ReturnType<typeof vi.fn>;
    saveDevProductTranslation: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    apiService = {
      me: vi.fn().mockReturnValue(
        of({
          user: {
            id: 'user-1',
            email: 'test@example.com',
            displayName: 'Тест',
            householdId: 'household-1',
            authProvider: 'password',
          },
        }),
      ),
      getAuthProviders: vi
        .fn()
        .mockReturnValue(of({ password: true, google: false, apple: false })),
      getState: vi.fn().mockReturnValue(
        of({
          fridgeItems: [],
          shoppingItems: [],
          household: { id: 'household-1', name: 'Дом', members: [] },
        }),
      ),
      createFridgeItem: vi.fn().mockImplementation((payload: Record<string, unknown>) =>
        of({
          id: 'fridge-1',
          createdAt: '2026-08-26T00:00:00.000Z',
          updatedAt: '2026-08-26T00:00:00.000Z',
          ...payload,
        }),
      ),
      consumeFridgeItem: vi.fn().mockReturnValue(of({ removed: true, item: null })),
      moveFridgeToShopping: vi.fn().mockReturnValue(
        of({
          id: 'moved-1',
          name: 'Test item',
          quantity: 1,
          unit: 'шт.',
          category: 'products',
          checked: false,
        }),
      ),
      deleteFridgeItem: vi.fn().mockReturnValue(of(undefined)),
      createShoppingItem: vi.fn().mockImplementation((payload: Record<string, unknown>) =>
        of({
          id: 'shopping-1',
          checked: false,
          createdAt: '2026-08-26T00:00:00.000Z',
          updatedAt: '2026-08-26T00:00:00.000Z',
          ...payload,
        }),
      ),
      addRecipeIngredientsToShopping: vi
        .fn()
        .mockReturnValue(of({ items: [], addedCount: 0, skippedCount: 0 })),
      deleteDish: vi.fn().mockReturnValue(of(undefined)),
      getNotifications: vi.fn().mockReturnValue(of({ notifications: [] })),
      getSupportTickets: vi.fn().mockReturnValue(of({ tickets: [] })),
      getRecipeMatches: vi.fn().mockReturnValue(of({ recipes: [] })),
      createDish: vi.fn().mockReturnValue(of({ recipes: [] })),
      updateRecipe: vi.fn().mockReturnValue(of({ recipes: [] })),
      getRecipes: vi.fn().mockReturnValue(of({ recipes: [] })),
      getDishes: vi.fn().mockReturnValue(of({ recipes: [] })),
      saveDevRecipeTranslation: vi.fn(),
      saveDevProductTranslation: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: ApiService,
          useValue: apiService,
        },
      ],
    }).compileComponents();
  });

  it('saves manual recipe translations and updates the admin status without hiding failures', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const recipe = {
      id: 'translation-test',
      title: 'Машинное название',
      description: '',
      instructions: ['Машинный шаг'],
      products: [],
      translationStatus: 'machine',
    };
    app.devRecipes.set([recipe]);
    app.editDevRecipeTranslation(recipe);
    app.devTranslationForm.title = 'Ручное название';
    app.devTranslationForm.instructions = 'Первый шаг\n\nВторой шаг';
    apiService.saveDevRecipeTranslation.mockReturnValueOnce(throwError(() => new Error('offline')));
    await app.saveDevTranslation();
    expect(app.devTranslationRecipe()).not.toBeNull();
    expect(app.devTranslationError()).toBeTruthy();
    apiService.saveDevRecipeTranslation.mockReturnValueOnce(
      of({
        recipe: {
          ...recipe,
          title: 'Ручное название',
          instructions: ['Первый шаг', 'Второй шаг'],
          translationStatus: 'manual',
        },
      }),
    );
    await app.saveDevTranslation();
    expect(apiService.saveDevRecipeTranslation).toHaveBeenLastCalledWith('translation-test', {
      title: 'Ручное название',
      description: '',
      instructions: ['Первый шаг', 'Второй шаг'],
    });
    expect(app.devRecipes()[0].translationStatus).toBe('manual');
    expect(app.devTranslationRecipe()).toBeNull();
    fixture.destroy();
  });

  it('updates a manually translated product everywhere in the admin recipe list', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const product = { id: 'product', name: 'rice', translationStatus: 'original' };
    app.devProducts.set([product]);
    app.devRecipes.set([{ id: 'recipe', products: [product], ingredients: ['rice'] }]);
    app.editDevProductTranslation(product);
    app.devTranslationForm.productName = 'Рис';
    apiService.saveDevProductTranslation.mockReturnValueOnce(
      of({ product: { ...product, name: 'Рис', translationStatus: 'manual' } }),
    );
    await app.saveDevTranslation();
    expect(apiService.saveDevProductTranslation).toHaveBeenCalledWith('product', 'Рис');
    expect(app.devRecipes()[0].ingredients).toEqual(['Рис']);
    expect(app.devProducts()[0].translationStatus).toBe('manual');
    expect(app.devTranslationProduct()).toBeNull();
    fixture.destroy();
  });

  it('does not grant frontend admin access from an unverified owner email', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    app.currentUser.set({ id: 'owner', email: 'vladfinder@yandex.ru', isAdmin: false });
    expect(app.hasDevAccess()).toBe(false);
    app.currentUser.set({ id: 'owner', email: 'vladfinder@yandex.ru', isAdmin: true });
    expect(app.hasDevAccess()).toBe(true);
    fixture.destroy();
  });

  it('keeps recipe preferences separate between accounts and ignores malformed caches', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    const firstKey = 'eat-it.recipes.account-first';
    const secondKey = 'eat-it.recipes.account-second';
    try {
      app.currentUser.set({ id: 'account-first' });
      app.recipes.set([{ id: 'private-recipe', title: 'Private recipe', liked: true, mine: true }]);
      app.persistRecipes();
      app.loadAccountPreferences('account-second');
      expect(app.recipes()).toEqual([]);
      app.loadAccountPreferences('account-first');
      expect(app.recipes()[0].id).toBe('private-recipe');
      localStorage.setItem(secondKey, '{}');
      app.loadAccountPreferences('account-second');
      expect(app.recipes()).toEqual([]);
    } finally {
      localStorage.removeItem(firstKey);
      localStorage.removeItem(secondKey);
      fixture.destroy();
    }
  });

  it('clears recipes, meal plans, admin data and open dialogs on logout', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    apiService.clearSessionToken = vi.fn();
    for (const field of [
      'recipes',
      'mealPlan',
      'devUsers',
      'devRecipes',
      'recipeDishIdeas',
      'userDishIdeas',
    ]) {
      app[field].set([{ id: 'private-record' }]);
    }
    app.activeRecipe.set({ id: 'private-record' });
    app.fridgeAddOpen.set(true);
    app.resetSession();
    for (const field of [
      'recipes',
      'mealPlan',
      'devUsers',
      'devRecipes',
      'recipeDishIdeas',
      'userDishIdeas',
    ]) {
      expect(app[field]()).toEqual([]);
    }
    expect(app.activeRecipe()).toBeNull();
    expect(app.fridgeAddOpen()).toBe(false);
    fixture.destroy();
  });

  it('does not restore private data from a response arriving after logout', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    apiService.clearSessionToken = vi.fn();
    app.currentUser.set({ id: 'user-before-logout' });
    const response = new Subject();
    apiService.getState.mockReturnValue(response);
    const pending = app.loadState();
    app.resetSession();
    response.next({
      fridgeItems: [{ id: 'private-stock' }],
      shoppingItems: [],
      household: { id: 'old-home' },
    });
    response.complete();
    await pending;
    expect(app.fridgeItems()).toEqual([]);
    expect(app.household()).toBeNull();
    fixture.destroy();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the authentication screen', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('С возвращением');
    expect(compiled.textContent).toContain('Проверяем сессию');
  });

  it('stores household items without expiry date', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    await fixture.whenStable();

    app.setCategory('household');
    app.newFridgeItem.name = 'Капсулы для стирки';
    app.newFridgeItem.quantity = 2;

    await app.addFridgeItem();

    expect(apiService.createFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Капсулы для стирки',
        category: 'household',
        expiresAt: null,
        reminderDays: 0,
      }),
    );
  });

  it('stores products without expiry date when no-expiry is enabled', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    await fixture.whenStable();

    app.setCategory('products');
    app.newFridgeItem.name = 'Кофе';
    app.newFridgeItem.noExpiry = true;

    await app.addFridgeItem();

    expect(apiService.createFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Кофе',
        category: 'products',
        expiresAt: null,
        reminderDays: 0,
      }),
    );
  });

  it('stores medicine with an expiry date', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    await fixture.whenStable();

    app.setCategory('medicine');
    app.newFridgeItem.name = 'Ибупрофен';
    app.newFridgeItem.expiresAt = '2027-01-15';

    await app.addFridgeItem();

    expect(apiService.createFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ибупрофен',
        category: 'medicine',
        expiresAt: '2027-01-15',
      }),
    );
  });

  it('adds a fully consumed item to shopping after confirmation', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    await fixture.whenStable();
    vi.spyOn(window, 'prompt').mockReturnValue('1');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await app.consumeFridgeItem({
      id: 'fridge-1',
      name: 'Молоко',
      quantity: 1,
      unit: 'л',
      expiresAt: '2026-09-10',
      reminderDays: 1,
      category: 'products',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    });

    expect(apiService.createShoppingItem).toHaveBeenCalledWith({
      name: 'Молоко',
      quantity: 1,
      unit: 'л',
      category: 'products',
    });
  });

  describe('inventory search and sorting', () => {
    function fridgeItem(
      id: string,
      name: string,
      category: 'products' | 'household' | 'medicine',
      createdAt: string,
      quantity = 1,
      expiresAt: string | null = null,
    ) {
      return {
        id,
        name,
        category,
        quantity,
        unit: 'шт.',
        expiresAt,
        reminderDays: 2,
        autoAddToShopping: false,
        createdAt,
        updatedAt: createdAt,
      };
    }

    function shoppingItem(
      id: string,
      name: string,
      category: 'products' | 'household' | 'medicine',
      createdAt: string,
      quantity: number,
      checked = false,
    ) {
      return {
        id,
        name,
        category,
        quantity,
        unit: 'шт.',
        checked,
        createdAt,
        updatedAt: createdAt,
      };
    }

    it('searches by a name fragment only inside the active stock section', () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      app.fridgeItems.set([
        fridgeItem('potato', 'Картошка', 'products', '2026-09-03T00:00:00.000Z'),
        fridgeItem('cabbage', 'Капуста', 'products', '2026-09-02T00:00:00.000Z'),
        fridgeItem('milk', 'Молоко', 'products', '2026-09-01T00:00:00.000Z'),
        fridgeItem('drops', 'Капли', 'medicine', '2026-09-04T00:00:00.000Z'),
      ]);

      app.activeCategory.set('products');
      app.fridgeSearch.set('КА');
      expect(app.visibleFridgeItems().map((item: any) => item.name)).toEqual([
        'Картошка',
        'Капуста',
      ]);

      app.activeCategory.set('medicine');
      expect(app.visibleFridgeItems().map((item: any) => item.name)).toEqual(['Капли']);
      fixture.destroy();
    });

    it('filters stock by expiry state and sorts it by expiry or name', () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      app.fridgeItems.set([
        fridgeItem('expired', 'Яблоко', 'products', '2026-09-01T00:00:00.000Z', 2, '2020-01-01'),
        fridgeItem('soon', 'Молоко', 'products', '2026-09-03T00:00:00.000Z', 1, app.addDays(1)),
        fridgeItem('no-expiry', 'Абрикос', 'products', '2026-09-02T00:00:00.000Z', 5),
      ]);

      app.fridgeStatusFilter.set('expired');
      expect(app.visibleFridgeItems().map((item: any) => item.id)).toEqual(['expired']);
      app.fridgeStatusFilter.set('soon');
      expect(app.visibleFridgeItems().map((item: any) => item.id)).toEqual(['soon']);
      app.fridgeStatusFilter.set('no-expiry');
      expect(app.visibleFridgeItems().map((item: any) => item.id)).toEqual(['no-expiry']);

      app.fridgeStatusFilter.set('all');
      app.fridgeSort.set('expiry');
      expect(app.visibleFridgeItems().map((item: any) => item.id)).toEqual([
        'expired',
        'soon',
        'no-expiry',
      ]);
      app.fridgeSort.set('name');
      expect(app.visibleFridgeItems().map((item: any) => item.id)).toEqual([
        'no-expiry',
        'soon',
        'expired',
      ]);
      fixture.destroy();
    });

    it('searches and sorts the current shopping section', () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      app.shoppingItems.set([
        shoppingItem('potato', 'Картошка', 'products', '2026-09-03T00:00:00.000Z', 2),
        shoppingItem('cabbage', 'Капуста', 'products', '2026-09-01T00:00:00.000Z', 5, true),
        shoppingItem('drops', 'Капли', 'medicine', '2026-09-04T00:00:00.000Z', 1),
      ]);

      app.activeShoppingFilter.set('products');
      app.shoppingSearch.set('ка');
      expect(app.visibleShoppingItems().map((item: any) => item.id)).toEqual(['potato', 'cabbage']);

      app.shoppingSearch.set('');
      app.shoppingSort.set('status');
      expect(app.visibleShoppingItems().map((item: any) => item.id)).toEqual(['potato', 'cabbage']);

      app.activeShoppingFilter.set('medicine');
      expect(app.visibleShoppingItems().map((item: any) => item.id)).toEqual(['drops']);
      fixture.destroy();
    });
  });

  describe('recipe flow', () => {
    async function readyApp() {
      const fixture = TestBed.createComponent(App);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      const app = fixture.componentInstance as any;
      await app.initializeSession();
      app.stopRealtimeRefresh();
      return { fixture, app };
    }

    function suggestion(id = 'ready', missing: string[] = []) {
      return {
        id,
        title: 'Омлет',
        source: 'user',
        image: null,
        subtitle: '20 мин.',
        description: 'Семейный рецепт',
        instructions: ['Разбейте яйца.', 'Приготовьте омлет.'],
        preparationMinutes: 20,
        ingredients: ['Яйца', ...missing],
        usedIngredients: ['Яйца'],
        missedIngredients: missing,
        usedIngredientCount: 1,
        missedIngredientCount: missing.length,
        expiringIngredientCount: 0,
        matchPercent: missing.length ? 50 : 100,
      };
    }

    it('refreshes stock before rolling, blocks double clicks and avoids immediate repeats', async () => {
      const { fixture, app } = await readyApp();
      vi.useFakeTimers();
      const response = new Subject<{ recipes: ReturnType<typeof suggestion>[] }>();
      apiService.getRecipeMatches.mockReturnValueOnce(response);
      try {
        const firstRoll = app.randomizeRecipe();
        await app.randomizeRecipe();
        expect(apiService.getRecipeMatches).toHaveBeenCalledTimes(1);
        expect(app.randomBusy()).toBe(true);
        response.next({ recipes: [suggestion('a'), suggestion('b')] });
        response.complete();
        await firstRoll;
        expect(app.randomRecipe()).toBeNull();
        expect(app.randomRolling()).toBe(true);
        vi.advanceTimersByTime(1350);
        const firstId = app.randomRecipe().id;
        expect(app.randomResultOpen()).toBe(true);
        apiService.getRecipeMatches.mockReturnValue(
          of({ recipes: [suggestion('a'), suggestion('b')] }),
        );
        await app.randomizeRecipe();
        vi.advanceTimersByTime(1350);
        expect(app.randomRecipe().id).not.toBe(firstId);
        expect(app.randomBusy()).toBe(false);
      } finally {
        fixture.destroy();
        vi.useRealTimers();
      }
    });

    it('shows no result on empty conditions or connection failure and cancels a roll on navigation', async () => {
      const { fixture, app } = await readyApp();
      vi.useFakeTimers();
      try {
        apiService.getRecipeMatches.mockReturnValue(
          of({ recipes: [suggestion('missing', ['Сыр'])] }),
        );
        await app.randomizeRecipe();
        expect(app.randomRecipe()).toBeNull();
        expect(app.randomError()).toContain('Нет подходящих');
        apiService.getRecipeMatches.mockReturnValue(of({ recipes: [suggestion()] }));
        await app.randomizeRecipe();
        app.setTab('fridge');
        vi.advanceTimersByTime(1350);
        expect(app.randomRecipe()).toBeNull();
        expect(app.randomBusy()).toBe(false);
        apiService.getRecipeMatches.mockReturnValue(throwError(() => new Error('offline')));
        await app.randomizeRecipe();
        expect(app.randomError()).toContain('подключение');
        expect(app.randomRolling()).toBe(false);
      } finally {
        fixture.destroy();
        vi.useRealTimers();
      }
    });

    it('respects reduced motion without delaying the result', async () => {
      const { fixture, app } = await readyApp();
      vi.useFakeTimers();
      const original = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });
      try {
        apiService.getRecipeMatches.mockReturnValue(of({ recipes: [suggestion()] }));
        await app.randomizeRecipe();
        vi.advanceTimersByTime(0);
        expect(app.randomRecipe()?.id).toBe('ready');
        expect(app.randomBusy()).toBe(false);
      } finally {
        window.matchMedia = original;
        fixture.destroy();
        vi.useRealTimers();
      }
    });

    it('opens the picked recipe in a modal, closes it and can reopen or navigate to its details', async () => {
      const { fixture, app } = await readyApp();
      // JSDOM does not implement the native dialog API. Browser checks cover focus and modality.
      const prototype = HTMLDialogElement.prototype;
      const descriptors = ['showModal', 'close'].map((name) =>
        Object.getOwnPropertyDescriptor(prototype, name),
      );
      Object.defineProperties(prototype, {
        showModal: {
          configurable: true,
          value(this: HTMLDialogElement) {
            this.open = true;
          },
        },
        close: {
          configurable: true,
          value(this: HTMLDialogElement) {
            this.open = false;
          },
        },
      });
      try {
        app.activeTab.set('pick');
        app.onboardingOpen.set(false);
        app.recipes.set([{ ...suggestion(), mine: true, liked: false, time: '20 мин.', tags: [] }]);
        app.randomRecipeId.set('ready');
        app.showRandomResult();
        fixture.detectChanges();
        await fixture.whenStable();
        const dialog = fixture.nativeElement.querySelector(
          '.random-result-dialog',
        ) as HTMLDialogElement;
        expect(dialog.open).toBe(true);
        expect(fixture.nativeElement.querySelector('.picker-screen > .random-result')).toBeNull();
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
        fixture.detectChanges();
        expect(app.randomResultOpen()).toBe(false);
        expect(app.randomRecipe()?.id).toBe('ready');
        app.showRandomResult();
        fixture.detectChanges();
        await fixture.whenStable();
        app.openRandomRecipe();
        fixture.detectChanges();
        expect(app.randomResultOpen()).toBe(false);
        expect(app.activeRecipe()?.id).toBe('ready');
      } finally {
        fixture.destroy();
        ['showModal', 'close'].forEach((name, index) => {
          const descriptor = descriptors[index];
          if (descriptor) Object.defineProperty(prototype, name, descriptor);
          else Reflect.deleteProperty(prototype, name);
        });
      }
    });

    it('rejects an old match response after inventory changes and refreshes an open recipe', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      const old = new Subject<{ recipes: ReturnType<typeof suggestion>[] }>();
      apiService.getRecipeMatches.mockReturnValueOnce(old);
      app.recipes.set([{ ...suggestion(), liked: true, mine: true }]);
      app.activeRecipe.set(app.recipes()[0]);
      const pending = app.refreshRecipeMatches();
      app.stateRevision++;
      apiService.getRecipeMatches.mockReturnValue(
        of({ recipes: [suggestion('ready', ['Молоко'])] }),
      );
      expect(await app.refreshRecipeMatches()).toBe(true);
      old.next({ recipes: [suggestion()] });
      old.complete();
      expect(await pending).toBe(false);
      expect(app.activeRecipe().missedIngredients).toEqual(['Молоко']);
      expect(app.recipes()[0].liked).toBe(true);
      fixture.destroy();
    });

    it('creates and edits real instructions, keeps raw ingredients and allows clearing an image', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      app.currentUser.set({ id: 'user-1' });
      apiService.createDish.mockReturnValue(of({ recipes: [suggestion()] }));
      app.openRecipeEditor();
      Object.assign(app.recipeForm, {
        title: ' Омлет ',
        ingredients: 'Яйца\nМолоко',
        instructions: 'Разбейте яйца.\nПриготовьте омлет.',
        preparationMinutes: 20,
      });
      await app.saveRecipe();
      expect(apiService.createDish).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Омлет',
          ingredients: ['Яйца', 'Молоко'],
          preparationMinutes: 20,
          instructions: ['Разбейте яйца.', 'Приготовьте омлет.'],
          imageUrl: null,
        }),
      );
      expect(app.recipes()[0].mine).toBe(true);
      expect(app.recipes()[0].preparationMinutes).toBe(20);
      app.openRecipeEditor({ ...app.recipes()[0], usedIngredients: ['Яйца 2 шт.'] });
      expect(app.recipeForm.ingredients).toBe('Яйца');
      app.recipeForm.imageUrl = '';
      apiService.updateRecipe.mockReturnValue(of({ recipes: [suggestion()] }));
      await app.saveRecipe();
      expect(apiService.updateRecipe).toHaveBeenCalledWith(
        'ready',
        expect.objectContaining({ imageUrl: null }),
      );
      fixture.destroy();
    });

    it('appends catalog pages in provider order, deduplicates cards and preserves retry position', async () => {
      const { fixture, app } = await readyApp();
      apiService.getRecipes.mockReturnValueOnce(
        of({ recipes: [suggestion('first')], nextOffset: 20, source: 'remote' }),
      );
      await app.loadRecipeCatalog();
      app.toggleRecipeLike('first');
      apiService.getRecipes.mockReturnValueOnce(throwError(() => new Error('offline')));
      await app.loadMoreRecipes();
      expect(app.catalogNextOffset()).toBe(20);
      expect(app.catalogLoadFailed()).toBe(true);
      expect(app.recipeList().map((r: any) => r.id)).toEqual(['first']);
      apiService.getRecipes.mockReturnValueOnce(
        of({
          recipes: [suggestion('first'), suggestion('second')],
          nextOffset: null,
          source: 'remote',
        }),
      );
      await app.loadMoreRecipes();
      expect(apiService.getRecipes).toHaveBeenLastCalledWith('', 20, 'remote');
      expect(app.recipeList().map((r: any) => r.id)).toEqual(['first', 'second']);
      expect(app.recipes().find((r: any) => r.id === 'first').liked).toBe(true);
      const calls = apiService.getRecipes.mock.calls.length;
      await app.loadMoreRecipes();
      expect(apiService.getRecipes).toHaveBeenCalledTimes(calls);
      fixture.destroy();
    });

    it('ignores an older search response and keeps the newest catalog result', async () => {
      const { fixture, app } = await readyApp();
      const old = new Subject<any>();
      apiService.getRecipes.mockReturnValueOnce(old);
      const pending = app.loadRecipeCatalog();
      app.recipeSearch.set('суп');
      apiService.getRecipes.mockReturnValueOnce(
        of({ recipes: [suggestion('soup')], nextOffset: null, source: 'remote' }),
      );
      await app.loadRecipeCatalog();
      old.next({ recipes: [suggestion('outdated')], nextOffset: 20, source: 'remote' });
      old.complete();
      await pending;
      expect(apiService.getRecipes).toHaveBeenLastCalledWith('суп', 0, 'auto');
      expect(app.recipeList().map((r: any) => r.id)).toEqual(['soup']);
      expect(app.catalogNextOffset()).toBeNull();
      fixture.destroy();
    });

    it('debounces search input and clears the pending search on session reset', async () => {
      const { fixture, app } = await readyApp();
      vi.useFakeTimers();
      try {
        apiService.clearSessionToken = vi.fn();
        app.setRecipeSearch('с');
        app.setRecipeSearch('суп');
        await vi.advanceTimersByTimeAsync(349);
        expect(apiService.getRecipes).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(apiService.getRecipes).toHaveBeenCalledTimes(1);
        expect(apiService.getRecipes).toHaveBeenLastCalledWith('суп', 0, 'auto');
        app.setRecipeSearch('паста');
        app.resetSession();
        await vi.advanceTimersByTimeAsync(400);
        expect(apiService.getRecipes).toHaveBeenCalledTimes(1);
        expect(app.catalogIds()).toBeNull();
      } finally {
        vi.useRealTimers();
        fixture.destroy();
      }
    });

    it('does not let a slow catalog request restore old ingredient availability after a mutation', async () => {
      const { fixture, app } = await readyApp();
      const old = new Subject<{ recipes: ReturnType<typeof suggestion>[] }>();
      apiService.getRecipes.mockReturnValue(old);
      const pending = app.loadRecipeCatalog();
      app.stateRevision++;
      apiService.getRecipeMatches.mockReturnValue(of({ recipes: [suggestion('ready', ['Сыр'])] }));
      old.next({ recipes: [suggestion()] });
      old.complete();
      await pending;
      expect(app.recipes()[0].missedIngredients).toEqual(['Сыр']);
      fixture.destroy();
    });

    it('does not open an editor for catalog recipes or submit a recipe without steps', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      app.openRecipeEditor({ ...suggestion(), mine: false });
      expect(app.recipeEditorOpen()).toBe(false);
      app.openRecipeEditor();
      Object.assign(app.recipeForm, { title: 'Омлет', ingredients: 'Яйца', instructions: '' });
      await app.saveRecipe();
      expect(apiService.createDish).not.toHaveBeenCalled();
      expect(app.recipeEditorError()).toContain('шаги');
      fixture.destroy();
    });

    it('renders ingredient labels for available and missing products and replaces the dishes tab', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      const app = fixture.componentInstance as any;
      app.stopRealtimeRefresh();
      app.loading.set(false);
      app.onboardingOpen.set(false);
      app.currentUser.set({ id: 'user-1', displayName: 'Тест', householdId: 'household-1' });
      app.activeTab.set('recipes');
      app.activeRecipe.set({
        ...suggestion('ready', ['Молоко']),
        mine: true,
        tags: [],
        time: '20 мин.',
      });
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('.recipe-ingredient.available').textContent,
      ).toContain('Яйца');
      expect(
        fixture.nativeElement.querySelector('.recipe-ingredient.missing').textContent,
      ).toContain('Молоко');
      expect(app.tabs.map((tab: { id: string }) => tab.id)).toContain('pick');
      expect(app.tabs.map((tab: { id: string }) => tab.id)).not.toContain('dishes');
      fixture.destroy();
    });

    function recipe(
      id: string,
      title: string,
      options: {
        missed?: string[];
        used?: string[];
        mine?: boolean;
        liked?: boolean;
        expiring?: number;
        match?: number;
      } = {},
    ) {
      return {
        id,
        title,
        time: '20 минут',
        tags: [],
        liked: options.liked ?? false,
        mine: options.mine ?? false,
        usedIngredients: options.used ?? [],
        missedIngredients: options.missed ?? [],
        expiringIngredientCount: options.expiring ?? 0,
        matchPercent: options.match ?? 0,
      };
    }

    it('searches recipes and applies availability and ownership filters', () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      app.recipes.set([
        recipe('omelet', 'Омлет', { used: ['Яйца', 'Сыр'], expiring: 1, match: 100 }),
        recipe('pasta', 'Паста', { used: ['Томат'], missed: ['Сыр'], match: 50 }),
        recipe('soup', 'Мой суп', { mine: true, liked: true, missed: ['Лук', 'Морковь'] }),
        recipe('cake', 'Торт', { missed: ['Мука', 'Сахар', 'Масло'] }),
      ]);

      app.recipeSearch.set('сыр');
      expect(app.recipeList().map((item: any) => item.id)).toEqual(['omelet', 'pasta']);
      app.recipeSearch.set('');
      app.activeRecipeTab.set('available');
      expect(app.recipeList().map((item: any) => item.id)).toEqual(['omelet']);
      app.activeRecipeTab.set('almost');
      expect(app.recipeList().map((item: any) => item.id)).toEqual(['pasta', 'soup']);
      app.activeRecipeTab.set('mine');
      expect(app.recipeList().map((item: any) => item.id)).toEqual(['soup']);
      app.activeRecipeTab.set('likes');
      expect(app.recipeList().map((item: any) => item.id)).toEqual(['soup']);
      fixture.destroy();
    });

    it('adds only server-approved missing ingredients to local shopping state', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      const shoppingItem = {
        id: 'shopping-cheese',
        name: 'Сыр',
        quantity: 1,
        unit: 'шт.',
        category: 'products',
        checked: false,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      };
      apiService.addRecipeIngredientsToShopping.mockReturnValue(
        of({ items: [shoppingItem], addedCount: 1, skippedCount: 1 }),
      );

      await app.addMissingIngredientsToShopping('recipe-1', ['Сыр', 'Молоко']);

      expect(apiService.addRecipeIngredientsToShopping).toHaveBeenCalledWith('recipe-1');
      expect(app.shoppingItems()).toEqual([shoppingItem]);
      expect(app.toastMessage()).toBe('Добавлено в покупки: 1');
      fixture.destroy();
    });

    it('removes a user recipe from dishes and recipes after API deletion', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      app.recipes.set([recipe('mine-1', 'Мой суп', { mine: true })]);
      app.userDishIdeas.set([{ id: 'mine-1', title: 'Мой суп' }]);

      await app.deleteUserDish('mine-1');

      expect(apiService.deleteDish).toHaveBeenCalledWith('mine-1');
      expect(app.recipes()).toEqual([]);
      expect(app.userDishIdeas()).toEqual([]);
      fixture.destroy();
    });
  });

  describe('card gestures', () => {
    async function renderCard(category = 'products', expiresAt: string | null = null) {
      const fixture = TestBed.createComponent(App);
      fixture.autoDetectChanges();
      await fixture.whenStable();
      const app = fixture.componentInstance as any;
      await app.initializeSession();
      app.stopRealtimeRefresh();
      app.currentUser.set({ id: 'user-1', displayName: 'Test', householdId: 'household-1' });
      app.loading.set(false);
      app.onboardingOpen.set(false);
      app.activeCategory.set(category);
      app.fridgeItems.set([
        {
          id: 'swipe-1',
          name: 'Test item',
          category,
          quantity: 1,
          unit: 'шт.',
          expiresAt,
          reminderDays: 1,
          autoAddToShopping: false,
        },
      ]);
      fixture.detectChanges();
      const card = fixture.nativeElement.querySelector('[data-swipe-id="swipe-1"]') as HTMLElement;
      expect(card).toBeTruthy();
      return { fixture, card, app };
    }

    function touch(target: Element, type: string, x: number, y: number, count = 1) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const points = Array.from({ length: count }, (_, identifier) => ({
        identifier,
        clientX: x,
        clientY: y,
      }));
      Object.defineProperty(event, 'touches', {
        value: Object.assign(points, { item: (i: number) => points[i] }),
      });
      target.dispatchEvent(event);
      return event;
    }

    for (const category of ['products', 'household', 'medicine']) {
      it(`moves ${category} to shopping on release without clicking or confirming`, async () => {
        const { fixture, card, app } = await renderCard(category);
        const confirm = vi.spyOn(window, 'confirm').mockClear();
        const content = card.querySelector('h3')!;
        touch(content, 'touchstart', 100, 150);
        const move = touch(content, 'touchmove', 190, 158);
        await fixture.whenStable();
        expect(move.defaultPrevented).toBe(true);
        expect(card.style.transform).toContain('translate3d(90px,');
        expect(card.classList.contains('is-swiping')).toBe(true);
        touch(content, 'touchend', 190, 158, 0);
        await fixture.whenStable();
        await vi.waitFor(() => expect(card.isConnected).toBe(false));
        expect(apiService.moveFridgeToShopping).toHaveBeenCalledExactlyOnceWith('swipe-1');
        expect(apiService.deleteFridgeItem).not.toHaveBeenCalled();
        expect(app.shoppingItems()).toEqual([expect.objectContaining({ id: 'moved-1' })]);
        expect(fixture.nativeElement.querySelector('.ticket-dialog')).toBeNull();
        expect(confirm).not.toHaveBeenCalled();
        fixture.destroy();
      });
    }

    it('deletes an expired item on release without a click or confirmation', async () => {
      const { fixture, card } = await renderCard('products', '2020-01-01');
      const confirm = vi.spyOn(window, 'confirm').mockClear();
      touch(card, 'touchstart', 200, 150);
      touch(card, 'touchmove', 90, 160);
      touch(card, 'touchend', 90, 160, 0);
      await fixture.whenStable();
      await vi.waitFor(() => expect(card.isConnected).toBe(false));
      expect(apiService.deleteFridgeItem).toHaveBeenCalledExactlyOnceWith('swipe-1');
      expect(apiService.moveFridgeToShopping).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      fixture.destroy();
    });

    it('leaves vertical scrolling native and locks its direction', async () => {
      const { fixture, card } = await renderCard();
      const scroll = vi.spyOn(window, 'scrollBy');
      touch(card, 'touchstart', 100, 150);
      expect(touch(card, 'touchmove', 103, 180).defaultPrevented).toBe(false);
      expect(touch(card, 'touchmove', 200, 190).defaultPrevented).toBe(false);
      touch(card, 'touchend', 200, 190, 0);
      await fixture.whenStable();
      expect(card.style.transform).toContain('translate3d(0px,');
      expect(scroll).not.toHaveBeenCalled();
      expect(apiService.deleteFridgeItem).not.toHaveBeenCalled();
      expect(apiService.moveFridgeToShopping).not.toHaveBeenCalled();
      scroll.mockRestore();
      fixture.destroy();
    });

    it('ignores duplicate touch pointer cancellation until touchend', async () => {
      const { fixture, card } = await renderCard();
      touch(card, 'touchstart', 100, 150);
      touch(card, 'touchmove', 130, 153);
      const cancel = new Event('pointercancel', { bubbles: true });
      Object.defineProperty(cancel, 'pointerType', { value: 'touch' });
      card.dispatchEvent(cancel);
      touch(card, 'touchmove', 190, 155);
      touch(card, 'touchend', 190, 155, 0);
      await fixture.whenStable();
      await vi.waitFor(() => expect(card.isConnected).toBe(false));
      expect(apiService.moveFridgeToShopping).toHaveBeenCalledTimes(1);
      fixture.destroy();
    });

    for (const finish of ['touchcancel', 'multitouch', 'short']) {
      it(`returns the card to rest after ${finish}`, async () => {
        const { fixture, card } = await renderCard();
        touch(card, 'touchstart', 100, 150);
        touch(card, 'touchmove', finish === 'short' ? 120 : 190, 153);
        if (finish === 'multitouch') touch(card, 'touchstart', 190, 153, 2);
        touch(card, finish === 'touchcancel' ? 'touchcancel' : 'touchend', 190, 153, 0);
        await fixture.whenStable();
        expect(card.style.transform).toContain('translate3d(0px,');
        expect(card.parentElement!.classList.contains('swipe-shopping')).toBe(false);
        expect(apiService.moveFridgeToShopping).not.toHaveBeenCalled();
        expect(apiService.deleteFridgeItem).not.toHaveBeenCalled();
        fixture.destroy();
      });
    }

    it('keeps the menu button clickable without starting a swipe', async () => {
      const { fixture, card } = await renderCard();
      const menu = card.querySelector('.menu-button') as HTMLButtonElement;
      touch(menu, 'touchstart', 100, 150);
      touch(menu, 'touchmove', 190, 153);
      touch(menu, 'touchend', 190, 153, 0);
      menu.click();
      await fixture.whenStable();
      expect(card.style.transform).toContain('translate3d(0px,');
      expect(fixture.nativeElement.querySelector('.ticket-dialog')).toBeTruthy();
      fixture.destroy();
    });

    it('sends only one request while a move is pending', async () => {
      const { fixture, card } = await renderCard();
      const pending = new Subject<any>();
      apiService.moveFridgeToShopping.mockReturnValue(pending);
      touch(card, 'touchstart', 100, 150);
      touch(card, 'touchmove', 200, 150);
      touch(card, 'touchend', 200, 150, 0);
      touch(card, 'touchend', 200, 150, 0);
      touch(card, 'touchstart', 100, 150);
      touch(card, 'touchmove', 200, 150);
      touch(card, 'touchend', 200, 150, 0);
      expect(apiService.moveFridgeToShopping).toHaveBeenCalledTimes(1);
      expect(card.isConnected).toBe(true);
      pending.next({ id: 'moved-1' });
      pending.complete();
      await vi.waitFor(() => expect(card.isConnected).toBe(false));
      fixture.destroy();
    });

    for (const direction of [1, -1]) {
      it(`restores the card on a failed ${direction === 1 ? 'move' : 'delete'} and allows retry`, async () => {
        const { fixture, card, app } = await renderCard();
        const method =
          direction === 1 ? apiService.moveFridgeToShopping : apiService.deleteFridgeItem;
        method.mockReturnValueOnce(throwError(() => new Error('offline')));
        touch(card, 'touchstart', 150, 150);
        touch(card, 'touchmove', 150 + direction * 100, 150);
        touch(card, 'touchend', 150 + direction * 100, 150, 0);
        await vi.waitFor(() => expect(app.committingSwipe()).toBeNull());
        await fixture.whenStable();
        expect(card.isConnected).toBe(true);
        expect(card.style.transform).toContain('translate3d(0px,');
        expect(app.shoppingItems()).toEqual([]);
        expect(app.apiError()).toBeTruthy();
        touch(card, 'touchstart', 150, 150);
        touch(card, 'touchmove', 150 + direction * 100, 150);
        touch(card, 'touchend', 150 + direction * 100, 150, 0);
        await vi.waitFor(() => expect(card.isConnected).toBe(false));
        expect(method).toHaveBeenCalledTimes(2);
        fixture.destroy();
      });
    }

    it('does not resurrect a moved item when an older refresh finishes', async () => {
      const { fixture, card, app } = await renderCard();
      const staleItems = app.fridgeItems();
      const pending = new Subject<any>();
      apiService.getState.mockReturnValueOnce(pending);
      const refresh = app.refreshState();
      touch(card, 'touchstart', 100, 150);
      touch(card, 'touchmove', 200, 150);
      touch(card, 'touchend', 200, 150, 0);
      await vi.waitFor(() => expect(card.isConnected).toBe(false));
      pending.next({
        fridgeItems: staleItems,
        shoppingItems: [],
        household: { id: 'household-1', name: 'Test' },
      });
      pending.complete();
      await refresh;
      expect(app.fridgeItems()).toEqual([]);
      expect(app.shoppingItems()).toHaveLength(1);
      fixture.destroy();
    });
  });
});
