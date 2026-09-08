import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { ApiService } from './core/api.service';

describe('App', () => {
  let apiService: {
    me: ReturnType<typeof vi.fn>;
    getAuthProviders: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    createFridgeItem: ReturnType<typeof vi.fn>;
    consumeFridgeItem: ReturnType<typeof vi.fn>;
    createShoppingItem: ReturnType<typeof vi.fn>;
    moveFridgeToShopping: ReturnType<typeof vi.fn>;
    deleteFridgeItem: ReturnType<typeof vi.fn>;
    getNotifications: ReturnType<typeof vi.fn>;
    getSupportTickets: ReturnType<typeof vi.fn>;
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
      getAuthProviders: vi.fn().mockReturnValue(of({ password: true, google: false, apple: false })),
      getState: vi.fn().mockReturnValue(
        of({ fridgeItems: [], shoppingItems: [], household: { id: 'household-1', name: 'Дом', members: [] } }),
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
      moveFridgeToShopping: vi.fn().mockReturnValue(of({ id: 'moved-1', name: 'Test item', quantity: 1, unit: 'шт.', category: 'products', checked: false })),
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
      getNotifications: vi.fn().mockReturnValue(of({ notifications: [] })),
      getSupportTickets: vi.fn().mockReturnValue(of({ tickets: [] })),
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
      app.fridgeItems.set([{
        id: 'swipe-1', name: 'Test item', category, quantity: 1, unit: 'шт.',
        expiresAt, reminderDays: 1, autoAddToShopping: false,
      }]);
      fixture.detectChanges();
      const card = fixture.nativeElement.querySelector('[data-swipe-id="swipe-1"]') as HTMLElement;
      expect(card).toBeTruthy();
      return { fixture, card, app };
    }

    function touch(target: Element, type: string, x: number, y: number, count = 1) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const points = Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y }));
      Object.defineProperty(event, 'touches', { value: Object.assign(points, { item: (i: number) => points[i] }) });
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
        const method = direction === 1 ? apiService.moveFridgeToShopping : apiService.deleteFridgeItem;
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
      pending.next({ fridgeItems: staleItems, shoppingItems: [], household: { id: 'household-1', name: 'Test' } });
      pending.complete();
      await refresh;
      expect(app.fridgeItems()).toEqual([]);
      expect(app.shoppingItems()).toHaveLength(1);
      fixture.destroy();
    });
  });
});
