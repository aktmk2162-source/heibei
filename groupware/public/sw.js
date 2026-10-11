// プッシュ通知を受け取って表示する Service Worker。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '社内グループウェア', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // そのトークを画面で開いて見ている最中なら通知しない
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = data.url ? new URL(data.url, self.location.origin).href : '';
      if (target && wins.some((w) => w.focused && w.visibilityState === 'visible' && w.url === target)) return;
      await self.registration.showNotification(data.title || '社内グループウェア', {
        body: data.body || '',
        tag: data.tag,
        renotify: !!data.tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        return win.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
