import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import trust from './ota-trust.json';
import { verifyUpdateManifest } from './live-update-manifest';

export const UPDATE_MANIFEST_VERIFIER = new InjectionToken('UPDATE_MANIFEST_VERIFIER', {
  providedIn: 'root',
  factory: () => verifyUpdateManifest,
});

const UPDATE_ORIGIN = 'https://homie-web.app/updates';
const STATE_KEY = `homie.update.${trust.runtime}`;
interface UpdateState {
  sequence: number;
  pending: string | null;
  failed: string | null;
}

@Injectable({ providedIn: 'root' })
export class LiveUpdateService {
  private readonly verifyManifest = inject(UPDATE_MANIFEST_VERIFIER);
  readonly isAndroid = Capacitor.getPlatform() === 'android';
  readonly releaseVersion = trust.runtime;
  readonly versionInfo = signal<{ appVersion: string; updateVersion: string | null } | null>(null);
  readonly phase = signal<'idle' | 'checking' | 'downloading' | 'installing' | 'error'>(
    this.isAndroid ? 'checking' : 'idle',
  );
  readonly percent = signal(0);
  readonly message = signal('');
  private busy = false;
  private ready = false;

  private readState(): UpdateState {
    try {
      const state = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as Partial<UpdateState>;
      return {
        sequence: Number.isSafeInteger(state.sequence) ? state.sequence! : 0,
        pending: typeof state.pending === 'string' ? state.pending : null,
        failed: typeof state.failed === 'string' ? state.failed : null,
      };
    } catch {
      return { sequence: 0, pending: null, failed: null };
    }
  }

  async start(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android' || this.busy) return;
    this.busy = true;
    this.phase.set('checking');
    this.percent.set(0);
    let listener: PluginListenerHandle | undefined;
    let previousState: UpdateState | undefined;
    try {
      const { bundle: current } = await CapacitorUpdater.current();
      const state = this.readState();
      // Called only after the Angular root rendered, never before bootstrap.
      if (!this.ready) {
        await CapacitorUpdater.notifyAppReady();
        this.ready = true;
        if (state.pending && state.pending !== current.version) state.failed = state.pending;
        state.pending = null;
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
      }
      const native = await CapacitorUpdater.getBuiltinVersion();
      this.versionInfo.set({
        appVersion: native.version,
        updateVersion: current.id === 'builtin' ? null : current.version,
      });
      if (native.version !== trust.runtime) throw new Error('Native runtime mismatch');
      const response = await fetch(`${UPDATE_ORIGIN}/${trust.runtime}/latest.json`, {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(7000),
      });
      if (response.status === 404) {
        this.phase.set('idle');
        return;
      }
      if (!response.ok) throw new Error('Update server unavailable');
      const text = await response.text();
      if (text.length > 16000) throw new Error('Update manifest too large');
      const manifest = await this.verifyManifest(JSON.parse(text), trust);
      if (
        manifest.version === current.version ||
        manifest.sequence <= state.sequence ||
        manifest.version === state.failed
      ) {
        this.phase.set('idle');
        return;
      }
      const { bundles } = await CapacitorUpdater.list();
      if (
        bundles.some((bundle) => bundle.version === manifest.version && bundle.status === 'error')
      ) {
        this.phase.set('idle');
        return;
      }
      this.phase.set('downloading');
      listener = await CapacitorUpdater.addListener('download', (event) => {
        if (event.bundle.version === manifest.version) {
          this.percent.set(Math.max(0, Math.min(100, Math.floor(event.percent))));
        }
      });
      const bundle = await CapacitorUpdater.download({
        url: `${UPDATE_ORIGIN}/${trust.runtime}/${manifest.version}-${manifest.sha256}.zip`,
        version: manifest.version,
        checksum: manifest.sha256,
      });
      // The native downloader verifies the complete archive's SHA-256 before extraction/activation.
      this.percent.set(100);
      this.phase.set('installing');
      previousState = state;
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          sequence: manifest.sequence,
          pending: manifest.version,
          failed: state.failed,
        } satisfies UpdateState),
      );
      await CapacitorUpdater.set({ id: bundle.id }); // Reload; failed launches roll back natively.
    } catch {
      if (previousState) {
        try {
          localStorage.setItem(STATE_KEY, JSON.stringify(previousState));
        } catch {
          /* Storage unavailable. */
        }
      }
      this.message.set(
        'Не удалось установить обновление. Проверьте подключение или откройте текущую версию.',
      );
      this.phase.set('error');
    } finally {
      await listener?.remove().catch(() => undefined);
      this.busy = false;
    }
  }

  continueCurrentVersion(): void {
    if (this.phase() === 'error') this.phase.set('idle');
  }
}
