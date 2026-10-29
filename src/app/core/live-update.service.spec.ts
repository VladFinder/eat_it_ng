import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { LiveUpdateService, UPDATE_MANIFEST_VERIFIER } from './live-update.service';
import { verifyUpdateManifest } from './live-update-manifest';
import trust from './ota-trust.json';

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: {
    current: vi.fn(),
    notifyAppReady: vi.fn(),
    getBuiltinVersion: vi.fn(),
    list: vi.fn(),
    addListener: vi.fn(),
    download: vi.fn(),
    set: vi.fn(),
  },
}));
const verifyManifest = vi.fn<typeof verifyUpdateManifest>();
const manifest = {
  schema: 1 as const,
  version: '2.1.2',
  runtime: trust.runtime,
  nativeFingerprint: trust.nativeFingerprint,
  sequence: 42,
  sha256: 'a'.repeat(64),
  bytes: 1024,
};
const bundle = {
  id: 'new',
  version: manifest.version,
  checksum: manifest.sha256,
  downloaded: '',
  status: 'pending' as const,
};
const key = `homie.update.${trust.runtime}`;

describe('Android live updates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.removeItem(key);
    TestBed.configureTestingModule({
      providers: [{ provide: UPDATE_MANIFEST_VERIFIER, useValue: verifyManifest }],
    });
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.mocked(CapacitorUpdater.current).mockResolvedValue({
      bundle: { ...bundle, id: 'builtin', version: 'builtin' },
      native: trust.runtime,
    });
    vi.mocked(CapacitorUpdater.notifyAppReady).mockResolvedValue({ bundle });
    vi.mocked(CapacitorUpdater.getBuiltinVersion).mockResolvedValue({ version: trust.runtime });
    vi.mocked(CapacitorUpdater.list).mockResolvedValue({ bundles: [] });
    vi.mocked(CapacitorUpdater.addListener).mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(CapacitorUpdater.download).mockResolvedValue(bundle);
    vi.mocked(CapacitorUpdater.set).mockResolvedValue(undefined);
    verifyManifest.mockResolvedValue(manifest);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  });
  it('does nothing in the browser', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(updater.phase()).toBe('idle');
    expect(updater.versionInfo()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('identifies the bundle included in the APK without inventing an OTA version', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(updater.versionInfo()).toEqual({ appVersion: trust.runtime, updateVersion: null });
  });
  it('keeps the active OTA version available when checking for updates fails offline', async () => {
    vi.mocked(CapacitorUpdater.current).mockResolvedValue({
      bundle: { ...bundle, id: 'installed', version: '2.0.5' },
      native: trust.runtime,
    });
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(updater.phase()).toBe('error');
    expect(updater.versionInfo()).toEqual({
      appVersion: trust.runtime,
      updateVersion: '2.0.5',
    });
  });
  it('reports the installed native version even when it differs from the OTA runtime', async () => {
    vi.mocked(CapacitorUpdater.getBuiltinVersion).mockResolvedValue({ version: '3.0.0' });
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(updater.versionInfo()?.appVersion).toBe('3.0.0');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('checks, downloads with a checksum, records pending and activates', async () => {
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(CapacitorUpdater.notifyAppReady).toHaveBeenCalledOnce();
    expect(CapacitorUpdater.download).toHaveBeenCalledWith(
      expect.objectContaining({ checksum: manifest.sha256 }),
    );
    expect(CapacitorUpdater.set).toHaveBeenCalledWith({ id: 'new' });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      sequence: 42,
      pending: '2.1.2',
      failed: null,
    });
    expect(updater.percent()).toBe(100);
    // A downloaded or pending bundle is not the version currently running.
    expect(updater.versionInfo()).toEqual({ appVersion: trust.runtime, updateVersion: null });
  });
  it('reports native download progress and ignores unrelated bundles', async () => {
    const updater = TestBed.inject(LiveUpdateService);
    vi.mocked(CapacitorUpdater.download).mockImplementation(async () => {
      const progress = vi.mocked(CapacitorUpdater.addListener).mock
        .calls[0]![1] as unknown as (event: { percent: number; bundle: typeof bundle }) => void;
      progress({ percent: 37, bundle });
      expect(updater.percent()).toBe(37);
      progress({ percent: 99, bundle: { ...bundle, version: 'unrelated' } });
      expect(updater.percent()).toBe(37);
      return bundle;
    });
    await updater.start();
    expect(updater.percent()).toBe(100);
  });
  it('does not activate an unverified update', async () => {
    verifyManifest.mockRejectedValue(new Error('bad signature'));
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(updater.phase()).toBe('error');
    expect(CapacitorUpdater.download).not.toHaveBeenCalled();
  });
  it('opens the current app if no update is published and permits offline fallback', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(updater.phase()).toBe('idle');
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await updater.start();
    expect(updater.phase()).toBe('error');
    updater.continueCurrentVersion();
    expect(updater.phase()).toBe('idle');
    expect(CapacitorUpdater.set).not.toHaveBeenCalled();
  });
  it('does not reinstall a rolled-back release or an older signed manifest', async () => {
    localStorage.setItem(key, JSON.stringify({ sequence: 42, pending: '2.1.2', failed: null }));
    await TestBed.inject(LiveUpdateService).start();
    expect(JSON.parse(localStorage.getItem(key)!).failed).toBe('2.1.2');
    expect(CapacitorUpdater.download).not.toHaveBeenCalled();
  });
  it('allows retry after native activation fails', async () => {
    vi.mocked(CapacitorUpdater.set).mockRejectedValueOnce(new Error('set failed'));
    const updater = TestBed.inject(LiveUpdateService);
    await updater.start();
    expect(JSON.parse(localStorage.getItem(key)!).sequence).toBe(0);
    expect(updater.phase()).toBe('error');
    vi.mocked(fetch).mockResolvedValue(new Response('{}'));
    await updater.start();
    expect(CapacitorUpdater.set).toHaveBeenCalledTimes(2);
  });
});
