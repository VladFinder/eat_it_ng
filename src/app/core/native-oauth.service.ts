import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiService } from './api.service';
import { AuthResponse } from './models';

const STORAGE_KEY = 'homie.native-oauth';
const MAX_WAIT_MS = 600_000;
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const NATIVE_OAUTH_NAVIGATE = new InjectionToken<(url: string) => void>(
  'native-oauth-navigate',
  {
    providedIn: 'root',
    factory: () => (url) => window.location.assign(url),
  },
);
export const NATIVE_OAUTH_CRYPTO = new InjectionToken<Crypto>('native-oauth-crypto', {
  providedIn: 'root',
  factory: () => globalThis.crypto,
});

interface PendingSignIn {
  id: string;
  verifier: string;
  expiresAt: number;
}
interface ActiveSignIn {
  proof: PendingSignIn;
  promise: Promise<AuthResponse>;
  resolve: (response: AuthResponse) => void;
  reject: (reason: Error) => void;
  timer: number;
}

@Injectable({ providedIn: 'root' })
export class NativeOAuthService {
  private readonly api = inject(ApiService);
  private readonly navigate = inject(NATIVE_OAUTH_NAVIGATE);
  private readonly crypto = inject(NATIVE_OAUTH_CRYPTO);
  readonly isNative = Capacitor.isNativePlatform();
  readonly pending = signal(false);
  private active: ActiveSignIn | null = null;
  private polling = false;
  private starting = false;

  constructor() {
    const check = () => {
      void this.poll();
    };
    if (this.isNative) {
      window.addEventListener('focus', check);
      window.addEventListener('pageshow', check);
      document.addEventListener('visibilitychange', check);
    }
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
      this.settle(new Error('Вход прерван. Попробуйте снова.'));
    });
  }

  hasPending(): boolean {
    return this.isNative && this.readPending() !== null;
  }

  async signIn(provider: 'google' | 'apple'): Promise<AuthResponse> {
    if (this.active) return this.active.promise;
    if (!this.isNative || this.starting) throw new Error('Вход уже выполняется.');
    this.starting = true;
    try {
      const verifier = encode(this.crypto.getRandomValues(new Uint8Array(32)));
      const challenge = encode(
        new Uint8Array(
          await this.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
        ),
      );
      const attempt = await firstValueFrom(
        this.api.startNativeOAuth(provider, challenge).pipe(timeout(15_000)),
      );
      const target = new URL(attempt.loginUrl);
      const expected = new URL(this.api.oauthUrl(provider));
      const expiresAt = Math.min(Date.parse(attempt.expiresAt), Date.now() + MAX_WAIT_MS);
      if (
        target.origin !== expected.origin ||
        target.pathname !== expected.pathname ||
        Boolean(target.username || target.password || target.hash) ||
        !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('native') ?? '') ||
        !/^[A-Za-z0-9_-]{43}$/.test(attempt.id) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        throw new Error('Не удалось начать вход. Попробуйте снова.');
      }
      const proof = { id: attempt.id, verifier, expiresAt };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(proof));
      const result = this.waitForResult(proof);
      try {
        this.navigate(target.toString());
      } catch {
        this.cancel();
      }
      return await result;
    } finally {
      this.starting = false;
    }
  }

  resume(): Promise<AuthResponse | null> {
    if (!this.isNative) return Promise.resolve(null);
    if (this.active) return this.active.promise;
    const proof = this.readPending();
    return proof ? this.waitForResult(proof) : Promise.resolve(null);
  }

  cancel(): void {
    const proof = this.active?.proof ?? this.readPending();
    this.settle(new Error('Вход отменён. Можно попробовать снова.'));
    this.clearProof();
    if (proof) {
      this.api
        .cancelNativeOAuth(proof.id, proof.verifier)
        .pipe(timeout(5_000))
        .subscribe({ error: () => undefined });
    }
  }

  private readPending(): PendingSignIn | null {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
      if (!value || typeof value !== 'object') return null;
      const proof = value as Record<string, unknown>;
      if (
        typeof proof['id'] === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(proof['id']) &&
        typeof proof['verifier'] === 'string' &&
        /^[A-Za-z0-9_-]{43,128}$/.test(proof['verifier']) &&
        typeof proof['expiresAt'] === 'number' &&
        proof['expiresAt'] > Date.now() &&
        proof['expiresAt'] <= Date.now() + MAX_WAIT_MS
      ) {
        return { id: proof['id'], verifier: proof['verifier'], expiresAt: proof['expiresAt'] };
      }
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Corrupt or unavailable session storage cannot restore an attempt. */
    }
    return null;
  }

  private waitForResult(proof: PendingSignIn): Promise<AuthResponse> {
    let resolve!: ActiveSignIn['resolve'];
    let reject!: ActiveSignIn['reject'];
    const promise = new Promise<AuthResponse>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    this.active = {
      proof,
      promise,
      resolve,
      reject,
      timer: window.setInterval(() => {
        void this.poll();
      }, 2_000),
    };
    this.pending.set(true);
    void this.poll();
    return promise;
  }

  private async poll(): Promise<void> {
    const active = this.active;
    if (!active || this.polling) return;
    if (Date.now() >= active.proof.expiresAt) {
      this.settle(new Error('Время ожидания входа истекло. Попробуйте снова.'));
      return;
    }
    this.polling = true;
    try {
      const response = await firstValueFrom(
        this.api.pollNativeOAuth(active.proof.id, active.proof.verifier).pipe(timeout(10_000)),
      );
      if (this.active === active && !('pending' in response)) this.settle(null, response);
    } catch (error) {
      if (
        this.active === active &&
        error instanceof HttpErrorResponse &&
        [400, 401, 403, 404, 410].includes(error.status)
      ) {
        this.settle(
          new Error('Не удалось завершить вход. Вернитесь в Homie и начните вход заново.'),
        );
      }
      // Temporary network failures are retried, including after returning from the browser.
    } finally {
      this.polling = false;
    }
  }

  private settle(error: Error | null, response?: AuthResponse): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    window.clearInterval(active.timer);
    this.clearProof();
    this.pending.set(false);
    if (error) active.reject(error);
    else if (response) active.resolve(response);
  }

  private clearProof(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Storage may become unavailable. */
    }
  }
}
