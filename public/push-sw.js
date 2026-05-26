self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'NuVira Juice Co.';
  const body = data.body || data.message || '';
  const url = data.url || data.deep_link || '/notifications';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || data.notification_id || undefined,
      data: {
        url,
        notification_id: data.notification_id || null,
      },
      requireInteraction: Boolean(data.requireInteraction),
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || '/notifications', self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of windows) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === self.location.origin) {
        await client.focus();
        return client.navigate(targetUrl);
      }
    }

    return clients.openWindow(targetUrl);
  })());
});
