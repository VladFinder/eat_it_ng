import { Directive, ElementRef, inject, OnDestroy, OnInit, output } from '@angular/core';

@Directive({ selector: '[appLoadMore]' })
export class LoadMoreDirective implements OnInit, OnDestroy {
  readonly appLoadMore = output<void>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: IntersectionObserver;

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.appLoadMore.emit();
      },
      { rootMargin: '300px' },
    );
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
