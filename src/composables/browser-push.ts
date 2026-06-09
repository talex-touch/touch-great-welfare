import type { PushSubscriptionPayload } from '~/shared/notifications'
import { urlBase64ToUint8Array } from './notifications'

interface BrowserPushSubscriptionResult {
  subscription: PushSubscriptionPayload
  permission: NotificationPermission
}

function assertBrowserPushSupported() {
  if (typeof Notification === 'undefined')
    throw new Error('当前浏览器不支持通知权限')
  if (!('serviceWorker' in navigator) || !('PushManager' in window))
    throw new Error('当前浏览器不支持 Push 通知')
}

function bytesEqual(left: ArrayBuffer | null | undefined, right: Uint8Array) {
  if (!left)
    return false

  const leftBytes = new Uint8Array(left)
  if (leftBytes.length !== right.length)
    return false

  return leftBytes.every((value, index) => value === right[index])
}

async function activeServiceWorkerRegistration(scriptUrl: string) {
  const registration = await navigator.serviceWorker.register(scriptUrl)
  if (registration.active)
    return registration

  const readyRegistration = await navigator.serviceWorker.ready
  if (!readyRegistration.active)
    throw new Error('浏览器 Push 初始化失败，请稍后重试')

  return readyRegistration
}

export async function subscribeBrowserPush(publicKey: string): Promise<BrowserPushSubscriptionResult> {
  assertBrowserPushSupported()

  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error('浏览器通知权限未授权')

  const applicationServerKey = urlBase64ToUint8Array(publicKey)
  const registration = await activeServiceWorkerRegistration('/notification-sw.js')
  const existing = await registration.pushManager.getSubscription()
  if (existing) {
    if (bytesEqual(existing.options?.applicationServerKey, applicationServerKey)) {
      return {
        permission,
        subscription: existing.toJSON() as PushSubscriptionPayload,
      }
    }

    await existing.unsubscribe()
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  })

  return {
    permission,
    subscription: subscription.toJSON() as PushSubscriptionPayload,
  }
}

export async function unsubscribeBrowserPush() {
  assertBrowserPushSupported()

  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  const endpoint = subscription?.endpoint ?? ''
  await subscription?.unsubscribe()
  return endpoint
}
