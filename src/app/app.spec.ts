import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { App } from './app';
import { ApiService } from './core/api.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: ApiService,
          useValue: {
            me: () =>
              of({
                user: {
                  id: 'user-1',
                  email: 'test@example.com',
                  displayName: 'Тест',
                  householdId: 'household-1',
                  authProvider: 'password',
                },
              }),
            getAuthProviders: () => of({ password: true, google: false, apple: false }),
            getState: () => of({ fridgeItems: [], shoppingItems: [] }),
          },
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
});
