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
  DevSummary,
  FeedbackItem,
  FridgeInput,
  FridgeItem,
  Household,
  ItemCategory,
  RecipeSuggestion,
  ShoppingInput,
  ShoppingItem,
  SupportMessage,
  SupportTicket,
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

  getSupportTickets(): Observable<{ tickets: SupportTicket[] }> {
    return this.http.get<{ tickets: SupportTicket[] }>(
      `${this.baseUrl}/support/tickets`,
      this.options(),
    );
  }

  createSupportTicket(input: { subject: string; message: string }): Observable<SupportTicket> {
    return this.http.post<SupportTicket>(`${this.baseUrl}/support/tickets`, input, this.options());
  }

  getSupportMessages(
    ticketId: string,
  ): Observable<{ ticket: SupportTicket; messages: SupportMessage[] }> {
    return this.http.get<{ ticket: SupportTicket; messages: SupportMessage[] }>(
      `${this.baseUrl}/support/tickets/${ticketId}/messages`,
      this.options(),
    );
  }

  sendSupportMessage(ticketId: string, message: string): Observable<SupportMessage> {
    return this.http.post<SupportMessage>(
      `${this.baseUrl}/support/tickets/${ticketId}/messages`,
      { message },
      this.options(),
    );
  }

  createFeedback(input: {
    type: 'idea' | 'bug' | 'other';
    message: string;
  }): Observable<FeedbackItem> {
    return this.http.post<FeedbackItem>(`${this.baseUrl}/feedback`, input, this.options());
  }

  getDevSummary(): Observable<DevSummary> {
    return this.http.get<DevSummary>(`${this.baseUrl}/dev/summary`, this.options());
  }

  getDevSupportTickets(): Observable<{ tickets: SupportTicket[] }> {
    return this.http.get<{ tickets: SupportTicket[] }>(
      `${this.baseUrl}/dev/support/tickets`,
      this.options(),
    );
  }

  getDevSupportMessages(
    ticketId: string,
  ): Observable<{ ticket: SupportTicket; messages: SupportMessage[] }> {
    return this.http.get<{ ticket: SupportTicket; messages: SupportMessage[] }>(
      `${this.baseUrl}/dev/support/tickets/${ticketId}/messages`,
      this.options(),
    );
  }

  sendDevSupportMessage(ticketId: string, message: string): Observable<SupportMessage> {
    return this.http.post<SupportMessage>(
      `${this.baseUrl}/dev/support/tickets/${ticketId}/messages`,
      { message },
      this.options(),
    );
  }

  closeDevSupportTicket(ticketId: string): Observable<SupportTicket> {
    return this.http.post<SupportTicket>(
      `${this.baseUrl}/dev/support/tickets/${ticketId}/close`,
      {},
      this.options(),
    );
  }

  getDevFeedback(): Observable<{ feedback: FeedbackItem[] }> {
    return this.http.get<{ feedback: FeedbackItem[] }>(
      `${this.baseUrl}/dev/feedback`,
      this.options(),
    );
  }

  closeDevFeedback(id: string): Observable<FeedbackItem> {
    return this.http.post<FeedbackItem>(
      `${this.baseUrl}/dev/feedback/${id}/close`,
      {},
      this.options(),
    );
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

  getRecipeSuggestions(): Observable<{ recipes: RecipeSuggestion[]; ingredients: string[] }> {
    return this.http.get<{ recipes: RecipeSuggestion[]; ingredients: string[] }>(
      `${this.baseUrl}/recipes/suggestions`,
      this.options(),
    );
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
      expiresAt: string | null;
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
