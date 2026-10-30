import { Component, input } from '@angular/core';

const ICON_PATHS = {
  barcode: 'M4 3H2v4M20 3h2v4M4 21H2v-4M20 21h2v-4M6 7v10M9 7v10M13 7v10M15 7v10M18 7v10',
  back: 'm15 6-6 6 6 6',
  chevron: 'm9 6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 13 4 4L19 7',
  more: 'M12 4h.01M12 12h.01M12 20h.01',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1.8 4.2L21 21',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  cart: 'M3 3h2l3 12h11l2-9H6M10 21h.01M18 21h.01',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01',
  book: 'M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 6 0 0 1 16 0v2',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01',
  mail: 'M3 5h18v14H3ZM3 5l9 8 9-8',
  feedback: 'M21 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3ZM12 7v4M12 14h.01',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6M12 7h.01',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3-1 2 3-2 3 3 1v3l-3 1 1 3-3 2-3-2-1 3H9l-1-3-3 1-2-3 2-3-3-1V9l3-1-1-3 3-2 3 2Z',
  logout: 'M9 4H4v16h5M9 12h12m-5-5 5 5-5 5',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
} as const;

export type IconName = keyof typeof ICON_PATHS;

@Component({
  selector: 'app-icon',
  host: { 'aria-hidden': 'true' },
  template: `
    <svg
      viewBox="0 0 24 24"
      focusable="false"
      [attr.fill]="filled() ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path [attr.d]="paths[name()]" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: var(--icon-size, 20px);
      height: var(--icon-size, 20px);
      line-height: 1;
      vertical-align: middle;
      pointer-events: none;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly filled = input(false);
  protected readonly paths = ICON_PATHS;
}
