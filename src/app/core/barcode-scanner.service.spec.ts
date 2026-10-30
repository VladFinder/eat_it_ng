import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BARCODE_CAMERA, BARCODE_DECODER, BarcodeScannerService } from './barcode-scanner.service';

const native = vi.hoisted(() => ({
  isGoogleBarcodeScannerModuleAvailable: vi.fn(),
  installGoogleBarcodeScannerModule: vi.fn(),
  scan: vi.fn(),
}));
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: native,
  BarcodeFormat: { Ean13: 'EAN_13', Ean8: 'EAN_8', UpcA: 'UPC_A', Itf: 'ITF' },
}));

describe('web barcode camera lifecycle', () => {
  function setup(
    getUserMedia: () => Promise<MediaStream>,
    decode: (
      stream: MediaStream,
      video: HTMLVideoElement,
      found: (value: string) => void,
    ) => Promise<{ stop(): void }>,
  ) {
    TestBed.configureTestingModule({
      providers: [
        { provide: BARCODE_CAMERA, useValue: { getUserMedia } },
        { provide: BARCODE_DECODER, useValue: async () => ({ decodeFromStream: decode }) },
      ],
    });
    return TestBed.inject(BarcodeScannerService);
  }

  it('stops tracks and late decoder controls when the first valid barcode is delivered', async () => {
    const trackStop = vi.fn(),
      decoderStop = vi.fn(),
      found = vi.fn();
    const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
    const scanner = setup(
      async () => stream,
      async (_stream, _video, callback) => {
        callback('not a product code');
        callback('4006381333931');
        callback('4006381333931');
        return { stop: decoderStop };
      },
    );
    await scanner.startWeb(document.createElement('video'), found, new AbortController().signal);
    expect(found).toHaveBeenCalledExactlyOnceWith('4006381333931');
    expect(trackStop).toHaveBeenCalled();
    expect(decoderStop).toHaveBeenCalled();
  });

  it('releases a camera granted after the scanner was closed without starting a decoder', async () => {
    let grant!: (value: MediaStream) => void;
    const permission = new Promise<MediaStream>((resolve) => {
      grant = resolve;
    });
    const stop = vi.fn(),
      decode = vi.fn();
    const scanner = setup(() => permission, decode);
    const abort = new AbortController();
    const scanning = scanner.startWeb(document.createElement('video'), vi.fn(), abort.signal);
    await Promise.resolve();
    abort.abort();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await scanning;
    expect(stop).toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  it('allows manual entry after permission denial and never requests microphone access', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const scanner = setup(getUserMedia, vi.fn());
    await expect(
      scanner.startWeb(document.createElement('video'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow('Разрешите доступ');
    expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
  });
});

describe('native barcode scanner', () => {
  it('installs a missing scanner module and restricts the UI to supported product formats', async () => {
    native.isGoogleBarcodeScannerModuleAvailable
      .mockResolvedValue({ available: true })
      .mockResolvedValueOnce({ available: false });
    native.installGoogleBarcodeScannerModule.mockResolvedValue(undefined);
    native.scan.mockResolvedValue({ barcodes: [{ rawValue: '4006381333931' }] });
    const scanner = TestBed.inject(BarcodeScannerService);
    expect(await scanner.scanNative(new AbortController().signal)).toBe('4006381333931');
    expect(native.installGoogleBarcodeScannerModule).toHaveBeenCalled();
    expect(native.scan).toHaveBeenCalledWith({ formats: ['EAN_13', 'EAN_8', 'UPC_A', 'ITF'] });
  });

  it('treats system cancellation as cancellation rather than a failed product lookup', async () => {
    native.isGoogleBarcodeScannerModuleAvailable.mockResolvedValue({ available: true });
    native.scan.mockRejectedValue(new Error('scan canceled.'));
    expect(
      await TestBed.inject(BarcodeScannerService).scanNative(new AbortController().signal),
    ).toBeNull();
  });
});
