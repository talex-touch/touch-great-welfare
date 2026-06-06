<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
    __welfareTurnstileLoading?: Promise<void>
  }
}

const props = defineProps<{
  siteKey: string
}>()

const emit = defineEmits<{
  verified: [token: string]
  expired: []
}>()

const containerRef = ref<HTMLElement>()
const widgetId = ref('')
const loadError = ref('')

function loadTurnstileScript() {
  if (window.turnstile)
    return Promise.resolve()

  window.__welfareTurnstileLoading ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-welfare-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.welfareTurnstile = 'true'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), { once: true })
    document.head.appendChild(script)
  })

  return window.__welfareTurnstileLoading
}

async function renderTurnstile() {
  if (!props.siteKey || !containerRef.value || widgetId.value)
    return

  try {
    loadError.value = ''
    await loadTurnstileScript()
    if (!window.turnstile || !containerRef.value)
      throw new Error('Turnstile 未就绪')

    widgetId.value = window.turnstile.render(containerRef.value, {
      'sitekey': props.siteKey,
      'callback': (token: string) => emit('verified', token),
      'expired-callback': () => {
        emit('expired')
        if (widgetId.value)
          window.turnstile?.reset(widgetId.value)
      },
      'error-callback': () => {
        loadError.value = 'Turnstile 校验失败，请刷新后重试'
        emit('expired')
      },
    })
  }
  catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Turnstile 加载失败'
  }
}

function removeTurnstile() {
  if (widgetId.value) {
    window.turnstile?.remove(widgetId.value)
    widgetId.value = ''
  }
}

watch(() => props.siteKey, () => {
  removeTurnstile()
  renderTurnstile()
})

onMounted(() => {
  renderTurnstile()
})

onBeforeUnmount(() => {
  removeTurnstile()
})
</script>

<template>
  <div class="turnstile-box">
    <div ref="containerRef" />
    <p v-if="loadError" class="field-hint text-rose-600 dark:text-rose-300">
      {{ loadError }}
    </p>
  </div>
</template>
