const sw = globalThis

sw.addEventListener('push', (event) => {
  event.waitUntil(
    sw.registration.showNotification('Touch Great Welfare', {
      body: '你有一条新的状态通知。',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url: '/dashboard/notifications',
      },
    }),
  )
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/dashboard/notifications'
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(client => 'focus' in client)
      if (existing)
        return existing.focus()

      return sw.clients.openWindow(url)
    }),
  )
})
