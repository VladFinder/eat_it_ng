import { inject, Injectable, InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { normalizeBarcode } from './barcode';

interface ScanControls {
  stop(): void;
}
interface WebDecoder {
  decodeFromStream(
    stream: MediaStream,
    video: HTMLVideoElement,
    found: (value: string) => void,
  ): Promise<ScanControls>;
}

export const BARCODE_CAMERA = new InjectionToken<Pick<MediaDevices, 'getUserMedia'> | undefined>(
  'barcode-camera',
  { providedIn: 'root', factory: () => navigator.mediaDevices },
);
export const BARCODE_DECODER = new InjectionToken<() => Promise<WebDecoder>>('barcode-decoder', {
  providedIn: 'root',
  factory: () => async () => {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
    reader.possibleFormats = [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.ITF,
    ];
    return {
      decodeFromStream: (stream, video, found) =>
        reader.decodeFromStream(stream, video, (result) => {
          if (result) found(result.getText());
        }),
    };
  },
});

@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {
  readonly native =
    Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('BarcodeScanner');
  private readonly camera = inject(BARCODE_CAMERA);
  private readonly decoder = inject(BARCODE_DECODER);

  async scanNative(signal: AbortSignal): Promise<string | null> {
    const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
    if (signal.aborted) return null;
    if (!(await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule();
      const deadline = Date.now() + 20_000;
      while (!signal.aborted && Date.now() < deadline) {
        if ((await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      if (signal.aborted) return null;
      if (!(await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()).available) {
        throw new Error(
          'Сканер ещё загружается. Подключитесь к интернету и повторите попытку или введите номер вручную.',
        );
      }
    }
    if (signal.aborted) return null;
    try {
      const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.Itf],
      });
      const value = result.barcodes[0]?.rawValue;
      return !signal.aborted && value && normalizeBarcode(value) ? value : null;
    } catch (error) {
      if (error instanceof Error && /scan cancel[le]*d/i.test(error.message)) return null;
      throw new Error(
        'Не удалось открыть сканер. Попробуйте ещё раз или введите номер под штрихкодом вручную.',
      );
    }
  }

  async startWeb(
    video: HTMLVideoElement,
    found: (value: string) => void,
    signal: AbortSignal,
  ): Promise<ScanControls> {
    if (!this.camera?.getUserMedia)
      throw new Error('Камера недоступна. Откройте Homie по HTTPS или введите номер вручную.');
    let stream: MediaStream | undefined;
    let controls: ScanControls | undefined;
    let stopped = signal.aborted;
    let delivered = false;
    const stop = () => {
      stopped = true;
      signal.removeEventListener('abort', stop);
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      if (stopped) return { stop };
      const reader = await this.decoder();
      if (stopped) return { stop };
      stream = await this.camera.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (stopped) {
        stop();
        return { stop };
      }
      controls = await reader.decodeFromStream(stream, video, (value) => {
        if (!stopped && !delivered && normalizeBarcode(value)) {
          delivered = true;
          stop();
          found(value);
        }
      });
      if (stopped) stop();
      return { stop };
    } catch (error) {
      stop();
      if (signal.aborted) return { stop };
      const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
      const denied =
        typeof name === 'string' && ['NotAllowedError', 'PermissionDeniedError'].includes(name);
      throw new Error(
        denied
          ? 'Разрешите доступ к камере в настройках браузера или введите номер вручную.'
          : 'Не удалось включить камеру. Закройте другие приложения с камерой или введите номер вручную.',
      );
    }
  }
}
