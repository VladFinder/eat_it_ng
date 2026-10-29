import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { createHash, webcrypto } from 'node:crypto';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { AuthResponse, NativeOAuthResult } from './models';
import {
  NativeOAuthService,
  NATIVE_OAUTH_CRYPTO,
  NATIVE_OAUTH_NAVIGATE,
} from './native-oauth.service';

const storage = 'homie.native-oauth';
const response: AuthResponse = {
  token: 'native-session',
  expiresAt: '2026-12-01T00:00:00Z',
  user: {
    id: 'google-user',
    email: 'google@example.test',
    displayName: 'Google user',
    householdId: 'home',
    authProvider: 'google',
  },
};

describe('NativeOAuthService', () => {
  let service: NativeOAuthService;
  let api: {
    startNativeOAuth: ReturnType<typeof vi.fn>;
    pollNativeOAuth: ReturnType<typeof vi.fn>;
    cancelNativeOAuth: ReturnType<typeof vi.fn>;
    oauthUrl: ReturnType<typeof vi.fn>;
  };
  const navigate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionStorage.removeItem(storage);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    api = {
      startNativeOAuth: vi.fn().mockReturnValue(
        of({
          id: 'a'.repeat(43),
          loginUrl: 'https://homie-web.app/api/auth/google?native=' + 'b'.repeat(43),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
      pollNativeOAuth: vi.fn().mockReturnValue(of({ pending: true })),
      cancelNativeOAuth: vi.fn().mockReturnValue(of({ success: true })),
      oauthUrl: vi.fn().mockReturnValue('https://homie-web.app/api/auth/google'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: NATIVE_OAUTH_NAVIGATE, useValue: navigate },
        { provide: NATIVE_OAUTH_CRYPTO, useValue: webcrypto as unknown as Crypto },
      ],
    });
    service = TestBed.inject(NativeOAuthService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.removeItem(storage);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function opened() {
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    return JSON.parse(sessionStorage.getItem(storage)!);
  }

  it('keeps the verifier out of the browser URL and signs in after returning to the app', async () => {
    const result = service.signIn('google');
    const proof = await opened();
    expect(service.pending()).toBe(true);
    expect(navigate.mock.calls[0]![0]).not.toContain(proof.verifier);
    expect(api.startNativeOAuth).toHaveBeenCalledWith(
      'google',
      createHash('sha256').update(proof.verifier).digest('base64url'),
    );
    api.pollNativeOAuth.mockReturnValue(of(response));
    window.dispatchEvent(new Event('focus'));
    await expect(result).resolves.toEqual(response);
    expect(service.pending()).toBe(false);
    expect(sessionStorage.getItem(storage)).toBeNull();
  });

  it('retries temporary network failures without reopening the browser', async () => {
    api.pollNativeOAuth.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
    const result = service.signIn('google');
    await opened();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(service.pending()).toBe(true);
    api.pollNativeOAuth.mockReturnValue(of(response));
    document.dispatchEvent(new Event('visibilitychange'));
    await expect(result).resolves.toEqual(response);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('cancels the attempt using the original proof and clears pending state', async () => {
    const result = service.signIn('google');
    const rejection = expect(result).rejects.toThrow('Вход отменён');
    const proof = await opened();
    service.cancel();
    await rejection;
    expect(api.cancelNativeOAuth).toHaveBeenCalledWith(proof.id, proof.verifier);
    expect(sessionStorage.getItem(storage)).toBeNull();
    expect(service.pending()).toBe(false);
  });

  it('expires a stalled sign-in instead of leaving the form disabled forever', async () => {
    const result = service.signIn('google');
    const rejection = expect(result).rejects.toThrow('Время ожидания');
    await opened();
    await vi.advanceTimersByTimeAsync(62_000);
    await rejection;
    expect(service.pending()).toBe(false);
    expect(sessionStorage.getItem(storage)).toBeNull();
  });

  it('restores a pending sign-in after a WebView reload', async () => {
    sessionStorage.setItem(
      storage,
      JSON.stringify({
        id: 'a'.repeat(43),
        verifier: 'c'.repeat(43),
        expiresAt: Date.now() + 60_000,
      }),
    );
    api.pollNativeOAuth.mockReturnValue(of(response));
    expect(service.hasPending()).toBe(true);
    await expect(service.resume()).resolves.toEqual(response);
    expect(api.startNativeOAuth).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('rejects a launch URL outside the trusted provider endpoint', async () => {
    api.startNativeOAuth.mockReturnValue(
      of({
        id: 'a'.repeat(43),
        loginUrl: 'https://attacker.example/login',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    await expect(service.signIn('google')).rejects.toThrow('Не удалось начать вход');
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storage)).toBeNull();
  });

  it('clears a handoff lost after an API restart so sign-in can be retried', async () => {
    api.pollNativeOAuth.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 410 })));
    await expect(service.signIn('google')).rejects.toThrow('начните вход заново');
    expect(service.pending()).toBe(false);
    expect(service.hasPending()).toBe(false);
    expect(sessionStorage.getItem(storage)).toBeNull();
  });

  it('does not overlap polls or accept a late result after cancellation', async () => {
    const poll = new Subject<NativeOAuthResult>();
    api.pollNativeOAuth.mockReturnValue(poll);
    const result = service.signIn('google');
    const rejection = expect(result).rejects.toThrow('Вход отменён');
    await opened();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(api.pollNativeOAuth).toHaveBeenCalledOnce();
    service.cancel();
    poll.next(response);
    poll.complete();
    await rejection;
    expect(service.pending()).toBe(false);
    expect(sessionStorage.getItem(storage)).toBeNull();
  });
});
