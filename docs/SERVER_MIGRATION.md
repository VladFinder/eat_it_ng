# Переезд Eat It на новый VPS

Этот документ описывает безопасный переезд текущего production-деплоя без смены
архитектуры: Node.js API + Angular static build + Nginx + systemd + SQLite.

## Целевая схема

- Домен: `eat-it.space`, `www.eat-it.space`.
- Код приложения: `/opt/eat-it/app`.
- Статика Angular: `/var/www/eat-it/dist/eat_it_ng/browser`.
- База SQLite: `/opt/eat-it/app/data/eat-it.db`.
- API внутри сервера: `127.0.0.1:3010`.
- Nginx проксирует `/api/` в Node.js и отдает Angular build.

Для первого переноса достаточно VPS с 2 CPU, 4 GB RAM и 60-100 GB SSD. Если на
сервере будут храниться реальные пользовательские данные, бэкапы нужно включить
до публикации APK для внешних тестов.

## Что подготовить заранее

1. Новый VPS с Ubuntu 24.04 LTS или Debian 12.
2. SSH-доступ под пользователем с `sudo`.
3. Доступ к DNS домена.
4. Значения production-переменных из `/opt/eat-it/app/.env` на старом сервере.
5. Понимание, где лежит текущий SQLite-файл. По текущему systemd unit это:
   `/opt/eat-it/app/data/eat-it.db`.

## Установка базовых пакетов на новом сервере

```bash
sudo apt update
sudo apt install -y git nginx rsync curl ca-certificates build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

## Пользователь для автодеплоя из GitHub Actions

Создать отдельного пользователя:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG www-data deploy
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chown -R deploy:deploy /home/deploy/.ssh
```

На локальной машине создать SSH-ключ для GitHub Actions:

```bash
ssh-keygen -t ed25519 -C "github-actions-eat-it" -f eat-it-github-actions
```

Публичный ключ `eat-it-github-actions.pub` добавить на сервер:

```bash
sudo tee -a /home/deploy/.ssh/authorized_keys < eat-it-github-actions.pub
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

Пользователю `deploy` нужны права на обновление приложения, публикацию статики
и рестарт API:

```bash
sudo chown -R deploy:deploy /opt/eat-it/app /var/www/eat-it
sudo tee /etc/sudoers.d/eat-it-deploy >/dev/null <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart eat-it-api, /usr/bin/systemctl status eat-it-api, /usr/bin/chown -R www-data\:www-data /opt/eat-it/app/data
EOF
sudo chmod 440 /etc/sudoers.d/eat-it-deploy
sudo visudo -cf /etc/sudoers.d/eat-it-deploy
```

## Первый деплой на новом сервере

```bash
sudo mkdir -p /opt/eat-it /var/www/eat-it/dist/eat_it_ng/browser
sudo chown -R deploy:deploy /opt/eat-it /var/www/eat-it
sudo -iu deploy
git clone https://github.com/VladFinder/eat_it_ng.git /opt/eat-it/app
cd /opt/eat-it/app
npm ci
npm run db:generate
npm run build -- --configuration production
rsync -a --delete dist/eat_it_ng/browser/ /var/www/eat-it/dist/eat_it_ng/browser/
exit
```

Создать `/opt/eat-it/app/.env`:

```dotenv
DATABASE_URL="file:../data/eat-it.db"
PORT=3010
APP_URL="https://eat-it.space"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
APPLE_CLIENT_ID=""
APPLE_TEAM_ID=""
APPLE_KEY_ID=""
APPLE_PRIVATE_KEY=""
```

Не коммитить реальный `.env` в git.

## GitHub Secrets для автодеплоя

Workflow `.github/workflows/ci.yml` деплоит production после успешной сборки и
тестов на каждом push в `main`: обновляет код, ставит зависимости, генерирует
Prisma Client, собирает Angular, публикует статику и рестартит `eat-it-api`.
Миграции БД выполняет `eat-it-api.service` через `ExecStartPre` при рестарте
сервиса. В репозитории GitHub нужно добавить secrets:

- `DEPLOY_HOST`: IP нового сервера.
- `DEPLOY_USER`: `deploy`.
- `DEPLOY_SSH_KEY`: приватный ключ из файла `eat-it-github-actions`.
- `DEPLOY_PORT`: SSH-порт, обычно `22`.

Первый запуск можно сделать пустым коммитом:

```bash
git commit --allow-empty -m "Trigger production deploy"
git push origin main
```

После запуска открыть GitHub Actions и проверить job `deploy-production`.

## Перенос данных со старого сервера

На время финальной синхронизации лучше остановить API на старом сервере, чтобы
SQLite-файл не менялся во время копирования.

На старом сервере:

```bash
sudo systemctl stop eat-it-api
cd /opt/eat-it/app
sqlite3 data/eat-it.db "PRAGMA integrity_check;"
tar -czf /tmp/eat-it-migration.tgz .env data/eat-it.db
```

С локальной машины или с нового сервера скопировать архив:

```bash
scp old-server:/tmp/eat-it-migration.tgz .
scp eat-it-migration.tgz new-server:/tmp/eat-it-migration.tgz
```

На новом сервере:

```bash
cd /opt/eat-it/app
tar -xzf /tmp/eat-it-migration.tgz
mkdir -p data
npm run db:migrate
sudo chown -R www-data:www-data /opt/eat-it/app/data
```

Если нужно быстро откатиться, до переключения DNS старый сервер можно снова
запустить:

```bash
sudo systemctl start eat-it-api
```

## Настройка systemd

```bash
sudo cp /opt/eat-it/app/deploy/eat-it-api.service /etc/systemd/system/eat-it-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now eat-it-api
sudo systemctl status eat-it-api --no-pager
curl http://127.0.0.1:3010/api/health
```

## Настройка Nginx

```bash
sudo cp /opt/eat-it/app/deploy/nginx-eat-it.space.conf /etc/nginx/sites-available/eat-it.space
sudo ln -sfn /etc/nginx/sites-available/eat-it.space /etc/nginx/sites-enabled/eat-it.space
sudo nginx -t
sudo systemctl reload nginx
```

Проверить новый сервер до переключения DNS можно через `curl --resolve`:

```bash
curl --resolve eat-it.space:80:NEW_SERVER_IP http://eat-it.space/api/health
curl --resolve eat-it.space:80:NEW_SERVER_IP http://eat-it.space/
```

## HTTPS

После переключения DNS на новый IP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d eat-it.space -d www.eat-it.space
curl https://eat-it.space/api/health
```

## Переключение DNS

1. За 24 часа до переезда уменьшить TTL A-записей до 300 секунд.
2. После проверки нового сервера заменить A-записи `eat-it.space` и
   `www.eat-it.space` на новый IP.
3. Проверить:

```bash
dig +short eat-it.space
curl https://eat-it.space/api/health
```

4. Старый сервер держать включенным 24-48 часов для rollback.

## Бэкапы после переезда

Минимальный ежедневный бэкап SQLite:

```bash
sudo mkdir -p /var/backups/eat-it
sudo sqlite3 /opt/eat-it/app/data/eat-it.db ".backup '/var/backups/eat-it/eat-it-$(date +%F).db'"
sudo find /var/backups/eat-it -type f -name 'eat-it-*.db' -mtime +14 -delete
```

Для production лучше добавить внешний бэкап: S3-compatible storage, отдельный
сервер или snapshot провайдера. Бэкап считается рабочим только после тестового
восстановления.

## Проверка после переезда

- `systemctl status eat-it-api --no-pager` показывает running.
- `curl https://eat-it.space/api/health` возвращает успешный healthcheck.
- Главная страница открывается по HTTPS.
- Регистрация и вход по email работают.
- Google/Apple OAuth redirect URI указывают на `https://eat-it.space/...`.
- Android APK использует `https://eat-it.space/api`.
- На старом сервере нет новых записей после переключения DNS.

## Когда переходить с SQLite на PostgreSQL

SQLite можно оставить для закрытого теста и малого числа пользователей. Перед
публичным ростом лучше запланировать миграцию на PostgreSQL, потому что:

- проще делать надежные online-бэкапы;
- безопаснее обслуживать параллельные запросы;
- проще масштабировать API;
- Kubernetes и несколько реплик API требуют внешней БД, а не локального файла.
