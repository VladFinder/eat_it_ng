import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Observable } from 'rxjs';
import {
  AppState,
  AppNotification,
  AuthProviders,
  AuthResponse,
  AuthUser,
  FridgeInput,
  FridgeItem,
  Household,
  ItemCategory,
  ShoppingInput,
  ShoppingItem,
  Unit,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = Capacitor.isNativePlatform() ? 'https://eat-it.space/api' : '/api';
  private readonly tokenKey = 'eat-it.session-token';

  register(input: {
    displayName: string;
    email: string;
    password: string;
  }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/register`, input, {
      withCredentials: true,
    });
  }

  login(input: { email: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.baseUrl}/auth/login`, input, {
      withCredentials: true,
    });
  }

  me(): Observable<{ user: AuthUser }> {
    return this.http.get<{ user: AuthUser }>(`${this.baseUrl}/auth/me`, this.options());
  }

  logout(): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.baseUrl}/auth/logout`, {}, this.options());
  }

  deleteAccount(): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/auth/account`, this.options());
  }

  getAuthProviders(): Observable<AuthProviders> {
    return this.http.get<AuthProviders>(`${this.baseUrl}/auth/providers`);
  }

  oauthUrl(provider: 'google' | 'apple'): string {
    return `${this.baseUrl}/auth/${provider}`;
  }

  setSessionToken(token: string): void {
    if (Capacitor.isNativePlatform()) {
      localStorage.setItem(this.tokenKey, token);
    }
  }

  clearSessionToken(): void {
    localStorage.removeItem(this.tokenKey);
  }

  getState(): Observable<AppState> {
    return this.http.get<AppState>(`${this.baseUrl}/state`, this.options());
  }

  getHousehold(): Observable<Household> {
    return this.http.get<Household>(`${this.baseUrl}/household`, this.options());
  }

  renameHousehold(name: string): Observable<Household> {
    return this.http.patch<Household>(`${this.baseUrl}/household`, { name }, this.options());
  }

  addHouseholdMember(email: string): Observable<{ invitationId: string; status: string }> {
    return this.http.post<{ invitationId: string; status: string }>(
      `${this.baseUrl}/household/members`,
      { email },
      this.options(),
    );
  }

  getNotifications(): Observable<{ notifications: AppNotification[]; unreadCount: number }> {
    return this.http.get<{ notifications: AppNotification[]; unreadCount: number }>(
      `${this.baseUrl}/notifications`,
      this.options(),
    );
  }

  markNotification(id: string, read: boolean): Observable<AppNotification> {
    return this.http.patch<AppNotification>(
      `${this.baseUrl}/notifications/${id}`,
      { read },
      this.options(),
    );
  }

  respondToInvitation(id: string, action: 'accept' | 'decline'): Observable<Household> {
    return this.http.post<Household>(
      `${this.baseUrl}/household/invitations/${id}/${action}`,
      {},
      this.options(),
    );
  }

  createFridgeItem(input: FridgeInput): Observable<FridgeItem> {
    return this.http.post<FridgeItem>(`${this.baseUrl}/fridge`, input, this.options());
  }

  updateFridgeItem(id: string, input: Partial<FridgeInput>): Observable<FridgeItem> {
    return this.http.patch<FridgeItem>(`${this.baseUrl}/fridge/${id}`, input, this.options());
  }

  deleteFridgeItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/fridge/${id}`, this.options());
  }

  consumeFridgeItem(
    id: string,
    quantity: number,
  ): Observable<{ removed: boolean; item: FridgeItem | null }> {
    return this.http.post<{ removed: boolean; item: FridgeItem | null }>(
      `${this.baseUrl}/fridge/${id}/consume`,
      { quantity },
      this.options(),
    );
  }

  moveFridgeToShopping(id: string): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(
      `${this.baseUrl}/fridge/${id}/move-to-shopping`,
      {},
      this.options(),
    );
  }

  createShoppingItem(input: ShoppingInput): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(`${this.baseUrl}/shopping`, input, this.options());
  }

  updateShoppingItem(
    id: string,
    input: Partial<Pick<ShoppingItem, 'name' | 'quantity' | 'unit' | 'checked'>>,
  ): Observable<ShoppingItem> {
    return this.http.patch<ShoppingItem>(`${this.baseUrl}/shopping/${id}`, input, this.options());
  }

  deleteShoppingItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/shopping/${id}`, this.options());
  }

  moveShoppingToFridge(
    id: string,
    input: {
      quantity?: number;
      unit?: Unit;
      expiresAt: string;
      reminderDays?: number;
      category?: ItemCategory;
    },
  ): Observable<FridgeItem> {
    return this.http.post<FridgeItem>(
      `${this.baseUrl}/shopping/${id}/move-to-fridge`,
      input,
      this.options(),
    );
  }

  clearCompletedShoppingItems(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(
      `${this.baseUrl}/shopping/completed`,
      this.options(),
    );
  }

  private options(): { headers: HttpHeaders; withCredentials: boolean } {
    const token = localStorage.getItem(this.tokenKey);
    return {
      headers: token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders(),
      withCredentials: true,
    };
  }
}
