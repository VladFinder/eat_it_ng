import {
  afterNextRender,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiService } from '../core/api.service';
import { BarcodeScannerService } from '../core/barcode-scanner.service';
import { normalizeBarcode } from '../core/barcode';
import { BarcodeProduct, FridgeItem, ItemCategory, ShoppingItem, Unit } from '../core/models';
import { IconComponent } from '../ui/icon.component';

export type BarcodeAddition =
  { target: 'fridge'; item: FridgeItem } | { target: 'shopping'; item: ShoppingItem };

@Component({
  selector: 'app-barcode-add',
  imports: [FormsModule, IconComponent],
  templateUrl: './barcode-add.component.html',
  styleUrl: './barcode-add.component.scss',
})
export class BarcodeAddComponent implements OnInit, OnDestroy {
  readonly initialTarget = input<'fridge' | 'shopping'>('shopping');
  readonly initialCategory = input<ItemCategory>('products');
  readonly closed = output<void>();
  readonly added = output<BarcodeAddition>();
  protected readonly scanner = inject(BarcodeScannerService);
  private readonly api = inject(ApiService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  protected readonly scanning = signal(false);
  protected readonly lookingUp = signal(false);
  protected readonly saving = signal(false);
  protected readonly ready = signal(false);
  protected readonly lookupFailed = signal(false);
  protected readonly product = signal<BarcodeProduct | null>(null);
  protected readonly error = signal('');
  protected readonly cameraError = signal('');
  protected readonly units: Unit[] = ['шт.', 'упак.', 'г', 'кг', 'мл', 'л', 'бан.', 'бут.'];
  protected code = '';
  protected noExpiry = false;
  protected readonly form = {
    name: '',
    quantity: 1,
    unit: 'шт.' as Unit,
    category: 'products' as ItemCategory,
    target: 'shopping' as 'fridge' | 'shopping',
    expiresAt: '',
  };
  private confirmedCode: string | null = null;
  private request = 0;
  private scanGeneration = 0;
  private scanAbort?: AbortController;
  private scanControls?: { stop(): void };
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      if (!this.destroyed) this.dialog().nativeElement.showModal();
    });
  }

  ngOnInit(): void {
    this.form.target = this.initialTarget();
    this.form.category = this.initialCategory();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.request++;
    this.stopCamera();
  }

  @HostListener('document:visibilitychange')
  protected onVisibilityChange(): void {
    if (document.hidden && !this.scanner.native) this.stopCamera();
  }

  protected close(): void {
    if (this.saving()) return;
    this.request++;
    this.stopCamera();
    this.closed.emit();
  }

  protected onDialogClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  protected changeCode(value: string): void {
    this.stopCamera();
    this.code = value;
    this.request++;
    this.lookingUp.set(false);
    this.ready.set(false);
    this.product.set(null);
    this.lookupFailed.set(false);
    this.confirmedCode = null;
    this.form.name = '';
    this.form.quantity = 1;
    this.form.unit = 'шт.';
    this.form.category = this.initialCategory();
    this.form.expiresAt = '';
    this.noExpiry = false;
    this.error.set('');
  }

  protected stopCamera(): void {
    this.scanGeneration++;
    this.scanAbort?.abort();
    this.scanAbort = undefined;
    this.scanControls?.stop();
    this.scanControls = undefined;
    this.scanning.set(false);
  }

  protected async scan(): Promise<void> {
    if (this.saving() || this.lookingUp() || this.scanning()) return;
    this.stopCamera();
    const generation = this.scanGeneration;
    const abort = new AbortController();
    this.scanAbort = abort;
    this.cameraError.set('');
    this.scanning.set(true);
    const found = (value: string) => {
      if (this.destroyed || generation !== this.scanGeneration) return;
      this.changeCode(value);
      void this.lookup();
    };
    try {
      if (this.scanner.native) {
        const value = await this.scanner.scanNative(abort.signal);
        if (this.destroyed || generation !== this.scanGeneration) return;
        if (value) found(value);
        else this.stopCamera();
      } else {
        const controls = await this.scanner.startWeb(
          this.video().nativeElement,
          found,
          abort.signal,
        );
        if (this.destroyed || generation !== this.scanGeneration) controls.stop();
        else this.scanControls = controls;
      }
    } catch (error) {
      if (this.destroyed || generation !== this.scanGeneration) return;
      this.stopCamera();
      this.cameraError.set(
        error instanceof Error ? error.message : 'Камера недоступна. Введите номер вручную.',
      );
    }
  }

  protected async lookup(): Promise<void> {
    if (this.saving()) return;
    this.stopCamera();
    const barcode = normalizeBarcode(this.code);
    if (!barcode) {
      this.error.set('Проверьте номер: нужны 8, 12, 13 или 14 цифр с упаковки.');
      return;
    }
    const request = ++this.request;
    this.lookingUp.set(true);
    this.ready.set(false);
    this.error.set('');
    this.product.set(null);
    this.lookupFailed.set(false);
    this.form.name = '';
    this.confirmedCode = barcode;
    try {
      const result = await firstValueFrom(this.api.lookupBarcode(barcode).pipe(timeout(12_000)));
      if (this.destroyed || request !== this.request) return;
      if (result.barcode !== barcode)
        throw new Error('Не удалось проверить товар. Повторите поиск.');
      this.product.set(result.product);
      if (result.product) {
        const { name, brand, category, unit } = result.product;
        this.form.name =
          brand && !name.toLocaleLowerCase().includes(brand.toLocaleLowerCase())
            ? `${name} ${brand}`.slice(0, 120)
            : name;
        this.form.category = category;
        this.form.unit = unit;
      }
      this.ready.set(true);
    } catch (error) {
      if (this.destroyed || request !== this.request) return;
      this.lookupFailed.set(true);
      this.ready.set(true);
      this.error.set(
        error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
          ? error.error.error
          : 'Поиск временно недоступен. Можно ввести название вручную.',
      );
    } finally {
      if (!this.destroyed && request === this.request) this.lookingUp.set(false);
    }
  }

  protected async save(): Promise<void> {
    const name = this.form.name.trim();
    const quantity = Number(this.form.quantity);
    if (
      this.saving() ||
      this.lookingUp() ||
      !this.ready() ||
      !this.confirmedCode ||
      this.confirmedCode !== normalizeBarcode(this.code)
    )
      return;
    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
      this.error.set('Укажите название и количество больше нуля.');
      return;
    }
    const expiresAt =
      this.form.category === 'household' || this.noExpiry ? null : this.form.expiresAt;
    if (this.form.target === 'fridge' && expiresAt === '') {
      this.error.set('Укажите срок годности с упаковки или выберите «Без срока».');
      return;
    }
    this.stopCamera();
    this.saving.set(true);
    this.error.set('');
    const input = {
      barcode: this.confirmedCode,
      name,
      quantity,
      unit: this.form.unit,
      category: this.form.category,
    };
    try {
      const result: BarcodeAddition =
        this.form.target === 'fridge'
          ? {
              target: 'fridge',
              item: await firstValueFrom(
                this.api.createFridgeItem({
                  ...input,
                  expiresAt,
                  reminderDays: expiresAt ? 1 : 0,
                  autoAddToShopping: false,
                }),
              ),
            }
          : { target: 'shopping', item: await firstValueFrom(this.api.createShoppingItem(input)) };
      if (!this.destroyed) this.added.emit(result);
    } catch (error) {
      if (!this.destroyed)
        this.error.set(
          error instanceof HttpErrorResponse && typeof error.error?.error === 'string'
            ? error.error.error
            : 'Не удалось добавить товар. Проверьте подключение и повторите попытку.',
        );
    } finally {
      if (!this.destroyed) this.saving.set(false);
    }
  }
}
