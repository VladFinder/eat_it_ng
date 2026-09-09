self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Homie', {
      body: payload.body ?? 'В приложении есть обновление.',
      icon: '/play-assets/homie-play-icon-512-v2.png',
      badge: '/play-assets/homie-play-icon-512-v2.png',
      tag: payload.tag,
      data: payload.data ?? { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        return existing.focus().then(() => existing.navigate(targetUrl));
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
