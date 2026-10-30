import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeAddComponent } from './barcode-add.component';
import { ApiService } from '../core/api.service';
import { BarcodeScannerService } from '../core/barcode-scanner.service';
import { BarcodeLookupResult } from '../core/models';

describe('barcode add workflow', () => {
  const code = '4006381333931';
  const known: BarcodeLookupResult = {
    barcode: '04006381333931',
    product: {
      name: 'Молоко',
      brand: 'Ферма',
      packageQuantity: '1 л',
      category: 'products',
      unit: 'шт.',
      source: 'open_food_facts',
    },
  };
  let api: {
    lookupBarcode: ReturnType<typeof vi.fn>;
    createFridgeItem: ReturnType<typeof vi.fn>;
    createShoppingItem: ReturnType<typeof vi.fn>;
  };
  beforeEach(async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(),
    });
    api = {
      lookupBarcode: vi.fn().mockReturnValue(of(known)),
      createFridgeItem: vi.fn().mockReturnValue(of({ id: 'f1' })),
      createShoppingItem: vi.fn().mockReturnValue(of({ id: 's1' })),
    };
    await TestBed.configureTestingModule({
      imports: [BarcodeAddComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: BarcodeScannerService, useValue: { native: false, startWeb: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('requires confirmation and saves a looked up product with the verified barcode', async () => {
    const fixture = TestBed.createComponent(BarcodeAddComponent),
      app = fixture.componentInstance;
    fixture.detectChanges();
    const added = vi.fn();
    app.added.subscribe(added);
    app['changeCode'](code);
    await app['lookup']();
    expect(app['form'].name).toBe('Молоко Ферма');
    expect(api.createShoppingItem).not.toHaveBeenCalled();
    await app['save']();
    expect(api.createShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: known.barcode, name: 'Молоко Ферма', quantity: 1 }),
    );
    expect(added).toHaveBeenCalledWith({ target: 'shopping', item: { id: 's1' } });
    fixture.destroy();
  });

  it('allows the confirmation button default action to submit its form', async () => {
    const fixture = TestBed.createComponent(BarcodeAddComponent),
      app = fixture.componentInstance;
    fixture.detectChanges();
    app['changeCode'](code);
    await app['lookup']();
    fixture.detectChanges();
    await fixture.whenStable();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.barcode-item-form button[type="submit"]',
    );
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    await fixture.whenStable();
    expect(api.createShoppingItem).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('never invents an expiry date and allows an explicit no-expiry choice', async () => {
    const fixture = TestBed.createComponent(BarcodeAddComponent),
      app = fixture.componentInstance;
    fixture.componentRef.setInput('initialTarget', 'fridge');
    fixture.detectChanges();
    app['changeCode'](code);
    await app['lookup']();
    await app['save']();
    expect(api.createFridgeItem).not.toHaveBeenCalled();
    expect(app['error']()).toContain('срок годности');
    app['noExpiry'] = true;
    await app['save']();
    expect(api.createFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null, reminderDays: 0 }),
    );
    fixture.destroy();
  });

  it('ignores lookup responses after the code changed and prevents saving the wrong product', async () => {
    const result = new Subject<BarcodeLookupResult>();
    api.lookupBarcode.mockReturnValue(result);
    const fixture = TestBed.createComponent(BarcodeAddComponent),
      app = fixture.componentInstance;
    fixture.detectChanges();
    app['changeCode'](code);
    const lookup = app['lookup']();
    app['changeCode']('96385074');
    result.next(known);
    result.complete();
    await lookup;
    await app['save']();
    expect(app['ready']()).toBe(false);
    expect(api.createShoppingItem).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('does not carry a different package expiry or quantity into a new scan', () => {
    const fixture = TestBed.createComponent(BarcodeAddComponent),
      app = fixture.componentInstance;
    fixture.detectChanges();
    app['form'].quantity = 5;
    app['form'].expiresAt = '2026-12-01';
    app['noExpiry'] = true;
    app['changeCode']('96385074');
    expect(app['form'].quantity).toBe(1);
    expect(app['form'].expiresAt).toBe('');
    expect(app['noExpiry']).toBe(false);
    fixture.destroy();
  });

  it('can add an unknown product manually even when the provider is unavailable', async () => {
    api.lookupBarcode.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'База недоступна' } })),
    );
    const fixture = TestBed.createComponent(BarcodeAddComponent),
      app = fixture.componentInstance;
    fixture.detectChanges();
    app['changeCode'](code);
    await app['lookup']();
    app['form'].name = 'Наш товар';
    await app['save']();
    expect(api.createShoppingItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Наш товар', barcode: known.barcode }),
    );
    fixture.destroy();
  });
});
