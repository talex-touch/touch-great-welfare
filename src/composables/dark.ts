import { ref, watch } from 'vue'

function getInitialDarkMode() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const isDark = ref(getInitialDarkMode())

watch(
  isDark,
  (value) => {
    if (typeof document === 'undefined')
      return

    document.documentElement.classList.toggle('dark', value)
  },
  { immediate: true },
)

export function toggleDark() {
  isDark.value = !isDark.value
}
