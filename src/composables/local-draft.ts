import { watch } from 'vue'

export function restoreLocalDraft<T extends Record<string, unknown>>(key: string, target: T) {
  if (typeof window === 'undefined')
    return

  const raw = window.localStorage.getItem(key)
  if (!raw)
    return

  try {
    const parsed = JSON.parse(raw) as Partial<T>
    Object.assign(target, parsed)
  }
  catch {
    window.localStorage.removeItem(key)
  }
}

export function persistLocalDraft<T extends Record<string, unknown>>(key: string, target: T) {
  if (typeof window === 'undefined')
    return () => {}

  return watch(
    target,
    (value) => {
      window.localStorage.setItem(key, JSON.stringify(value))
    },
    { deep: true },
  )
}

export function clearLocalDraft(key: string) {
  if (typeof window === 'undefined')
    return

  window.localStorage.removeItem(key)
}
