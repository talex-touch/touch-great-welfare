const sw = globalThis
const DEFAULT_NOTIFICATION_URL = '/dashboard/notifications'

sw.addEventListener('install', (event) => {
  event.waitUntil(sw.skipWaiting())
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim())
})

function readPushPayload(event) {
  if (!event.data) {
    return {
      title: 'Touch Great Welfare',
      body: '你有一条新的状态通知。',
      url: DEFAULT_NOTIFICATION_URL,
    }
  }

  try {
    const payload = event.data.json()
    return {
      title: payload.title || 'Touch Great Welfare',
      body: payload.body || '你有一条新的状态通知。',
      url: payload.url || DEFAULT_NOTIFICATION_URL,
    }
  }
  catch {
    return {
      title: 'Touch Great Welfare',
      body: event.data.text() || '你有一条新的状态通知。',
      url: DEFAULT_NOTIFICATION_URL,
    }
  }
}

function sameOriginUrl(value) {
  try {
    const url = new URL(value || DEFAULT_NOTIFICATION_URL, sw.location.origin)
    if (url.origin !== sw.location.origin)
      return DEFAULT_NOTIFICATION_URL
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return DEFAULT_NOTIFICATION_URL
  }
}

sw.addEventListener('push', (event) => {
  const payload = readPushPayload(event)
  event.waitUntil(
    sw.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url: sameOriginUrl(payload.url),
      },
    }),
  )
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(sameOriginUrl(event.notification.data?.url), sw.location.origin).toString()
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const exactClient = clients.find(client => client.url === targetUrl)
      if (exactClient && 'focus' in exactClient)
        return exactClient.focus()

      const navigableClient = clients.find(client => 'navigate' in client && 'focus' in client)
      if (navigableClient) {
        await navigableClient.navigate(targetUrl)
        return navigableClient.focus()
      }

      return sw.clients.openWindow(targetUrl)
    }),
  )
})
