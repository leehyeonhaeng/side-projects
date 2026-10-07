// 폰 푸시 (행컴퍼니 알림, backend/common/webpush.py). workbox 서비스 워커가 importScripts로 불러온다
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "알림", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "행포털", {
      body: d.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-64x64.png",
      tag: d.tag,
      data: { url: d.url || "/" },
    }),
  );
});

// 알림을 누르면 열려 있는 앱 창을 그 화면으로, 없으면 새로 연다
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
