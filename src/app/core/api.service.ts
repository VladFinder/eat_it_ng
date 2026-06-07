import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Observable } from 'rxjs';
import { AppState, FridgeInput, FridgeItem, ShoppingInput, ShoppingItem, Unit } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = Capacitor.isNativePlatform() ? 'https://eat-it.space/api' : '/api';

  getState(): Observable<AppState> {
    return this.http.get<AppState>(`${this.baseUrl}/state`);
  }

  createFridgeItem(input: FridgeInput): Observable<FridgeItem> {
    return this.http.post<FridgeItem>(`${this.baseUrl}/fridge`, input);
  }

  updateFridgeItem(id: string, input: Partial<FridgeInput>): Observable<FridgeItem> {
    return this.http.patch<FridgeItem>(`${this.baseUrl}/fridge/${id}`, input);
  }

  deleteFridgeItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/fridge/${id}`);
  }

  consumeFridgeItem(
    id: string,
    quantity: number,
  ): Observable<{ removed: boolean; item: FridgeItem | null }> {
    return this.http.post<{ removed: boolean; item: FridgeItem | null }>(
      `${this.baseUrl}/fridge/${id}/consume`,
      { quantity },
    );
  }

  moveFridgeToShopping(id: string): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(`${this.baseUrl}/fridge/${id}/move-to-shopping`, {});
  }

  createShoppingItem(input: ShoppingInput): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(`${this.baseUrl}/shopping`, input);
  }

  updateShoppingItem(
    id: string,
    input: Partial<Pick<ShoppingItem, 'name' | 'quantity' | 'unit' | 'checked'>>,
  ): Observable<ShoppingItem> {
    return this.http.patch<ShoppingItem>(`${this.baseUrl}/shopping/${id}`, input);
  }

  deleteShoppingItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/shopping/${id}`);
  }

  moveShoppingToFridge(
    id: string,
    input: { quantity?: number; unit?: Unit; expiresAt: string },
  ): Observable<FridgeItem> {
    return this.http.post<FridgeItem>(`${this.baseUrl}/shopping/${id}/move-to-fridge`, input);
  }

  clearCompletedShoppingItems(): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.baseUrl}/shopping/completed`);
  }
}
