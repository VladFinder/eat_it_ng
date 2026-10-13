import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';

describe('ApiService session transport', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('eat-it.session-token');
    vi.restoreAllMocks();
  });

  it('uses the HttpOnly cookie on the web even if a stale local token exists', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    localStorage.setItem('eat-it.session-token', 'stale-token');
    TestBed.inject(ApiService).me().subscribe();
    const request = http.expectOne('/api/auth/me');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.withCredentials).toBe(true);
    request.flush({ user: {} });
  });

  it('sends the native bearer token only to the HTTPS API', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const api = TestBed.inject(ApiService);
    api.setSessionToken('native-token');
    api.me().subscribe();
    const request = http.expectOne('https://homie-web.app/api/auth/me');
    expect(request.request.headers.get('Authorization')).toBe('Bearer native-token');
    request.flush({ user: {} });
    api.clearSessionToken();
    expect(localStorage.getItem('eat-it.session-token')).toBeNull();
  });
});
