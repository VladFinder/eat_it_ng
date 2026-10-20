import { afterNextRender, Component, inject } from '@angular/core';
import { LiveUpdateService } from './live-update.service';

@Component({
  selector: 'app-live-update',
  template: `
    @if (update.phase() !== 'idle') {
      <section class="update-screen" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div class="update-card">
          <div class="update-logo" aria-hidden="true">H</div>
          <p class="update-brand">HOMIE</p>
          <h1 id="update-title">
            {{
              update.phase() === 'checking'
                ? 'Проверяем обновления'
                : update.phase() === 'installing'
                  ? 'Почти готово'
                  : update.phase() === 'error'
                    ? 'Обновим чуть позже?'
                    : 'Обновляем Homie'
            }}
          </h1>
          @if (update.phase() === 'error') {
            <p role="alert">{{ update.message() }}</p>
            <button type="button" (click)="update.start()">Попробовать ещё раз</button>
            <button
              type="button"
              class="update-secondary"
              (click)="update.continueCurrentVersion()"
            >
              Открыть текущую версию
            </button>
          } @else {
            <p>
              {{
                update.phase() === 'checking'
                  ? 'Ищем свежую версию приложения'
                  : update.phase() === 'installing'
                    ? 'Запускаем новую версию…'
                    : 'Загружаем улучшения. Оставьте приложение открытым.'
              }}
            </p>
            <div
              class="update-progress"
              role="progressbar"
              aria-label="Загрузка обновления"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="update.phase() === 'checking' ? null : update.percent()"
              [class.update-checking]="update.phase() === 'checking'"
            >
              <span [style.width.%]="update.phase() === 'checking' ? 35 : update.percent()"></span>
            </div>
            <strong aria-live="polite">{{
              update.phase() === 'checking' ? 'Один момент…' : update.percent() + '%'
            }}</strong>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .update-screen {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
      background: radial-gradient(ellipse at top, #e0eedf, #f8f5ed 65%);
      color: #193d2b;
      overflow: auto;
    }
    .update-card {
      width: min(100%, 380px);
      text-align: center;
    }
    .update-logo {
      display: grid;
      place-items: center;
      margin: 0 auto 20px;
      width: 80px;
      height: 80px;
      border-radius: 26px;
      background: #214f37;
      color: #fff8e8;
      font-size: 48px;
      font-weight: 850;
      box-shadow: 0 12px 36px #214f3726;
    }
    .update-brand {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.18em;
    }
    h1 {
      font-size: clamp(24px, 7vw, 32px);
      line-height: 1.2;
      margin: 14px 0;
    }
    p {
      line-height: 1.6;
      color: #5b6c60;
    }
    .update-progress {
      height: 12px;
      border-radius: 30px;
      background: #dce5d9;
      overflow: hidden;
      margin: 30px 0 12px;
    }
    .update-progress span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, #43845b, #87b77a);
      transition: width 0.25s ease;
    }
    .update-checking span {
      animation: checking 1.3s ease-in-out infinite alternate;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 16px;
      padding: 16px;
      margin-top: 12px;
      background: #214f37;
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button.update-secondary {
      background: #e3e9dd;
      color: #214f37;
    }
    @keyframes checking {
      to {
        transform: translateX(185%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .update-progress span {
        animation: none;
        transition: none;
      }
    }
  `,
})
export class LiveUpdateComponent {
  readonly update = inject(LiveUpdateService);
  constructor() {
    afterNextRender(() => {
      void this.update.start();
    });
  }
}
