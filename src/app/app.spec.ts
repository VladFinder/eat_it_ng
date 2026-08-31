import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { App } from './app';
import { ApiService } from './core/api.service';

describe('App', () => {
  let apiService: {
    me: ReturnType<typeof vi.fn>;
    getAuthProviders: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    createFridgeItem: ReturnType<typeof vi.fn>;
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
});
