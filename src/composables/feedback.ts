import { readonly, ref } from 'vue'

const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
let lastAuthPromptAt = 0
let fetchPatched = false

function shouldHandleUnauthorized(response: Response) {
  if (response.status !== 401)
    return false

  try {
    const url = new URL(response.url)
    return url.origin === globalThis.location?.origin && url.pathname.startsWith('/api/')
  }
  catch {
    return false
  }
}

export function useWelfareFeedback() {
  function notify(message: string) {
    toastMessage.value = message

    if (toastTimer)
      clearTimeout(toastTimer)

    const duration = Math.min(Math.max(message.length * 80, 2800), 9000)
    toastTimer = setTimeout(() => {
      if (toastMessage.value === message)
        toastMessage.value = ''
    }, duration)
  }

  function notifyLoginRequired(message = '登录状态已失效，请重新登录后再查看材料。') {
    const now = Date.now()
    if (now - lastAuthPromptAt < 3000)
      return

    lastAuthPromptAt = now
    notify(message)
  }

  function installUnauthorizedFetchPrompt() {
    if (fetchPatched || typeof globalThis.fetch !== 'function')
      return

    const nativeFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (...args) => {
      const response = await nativeFetch(...args)
      if (shouldHandleUnauthorized(response))
        notifyLoginRequired()
      return response
    }
    fetchPatched = true
  }

  async function runSafely(action: () => void | Promise<void>, success: string) {
    try {
      await action()
      notify(success)
    }
    catch (error) {
      notify(error instanceof Error ? error.message : '操作失败')
    }
  }

  return {
    toastMessage: readonly(toastMessage),
    notify,
    notifyLoginRequired,
    installUnauthorizedFetchPrompt,
    runSafely,
  }
}
