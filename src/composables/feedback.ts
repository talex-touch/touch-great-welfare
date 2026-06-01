import { readonly, ref } from 'vue'

const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined

export function useWelfareFeedback() {
  function notify(message: string) {
    toastMessage.value = message

    if (toastTimer)
      clearTimeout(toastTimer)

    toastTimer = setTimeout(() => {
      if (toastMessage.value === message)
        toastMessage.value = ''
    }, 2800)
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
    runSafely,
  }
}
