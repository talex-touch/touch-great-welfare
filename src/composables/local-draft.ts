import { watch } from 'vue'

const LOCAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

interface LocalDraftEnvelope<T> {
  version: 1
  savedAt: number
  value: T
}

function now() {
  return Date.now()
}

function parseDraft<T extends Record<string, unknown>>(raw: string): Partial<T> | undefined {
  const parsed = JSON.parse(raw) as Partial<T> | LocalDraftEnvelope<Partial<T>>
  if (parsed && typeof parsed === 'object' && 'version' in parsed && 'savedAt' in parsed && 'value' in parsed) {
    const envelope = parsed as LocalDraftEnvelope<Partial<T>>
    if (!Number.isFinite(envelope.savedAt) || now() - envelope.savedAt > LOCAL_DRAFT_TTL_MS)
      return undefined
    return envelope.value
  }

  return parsed as Partial<T>
}

export function restoreLocalDraft<T extends Record<string, unknown>>(key: string, target: T) {
  if (typeof window === 'undefined')
    return

  const raw = window.localStorage.getItem(key)
  if (!raw)
    return

  try {
    const parsed = parseDraft<T>(raw)
    if (!parsed) {
      window.localStorage.removeItem(key)
      return
    }
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
      const envelope: LocalDraftEnvelope<T> = {
        version: 1,
        savedAt: now(),
        value,
      }
      window.localStorage.setItem(key, JSON.stringify(envelope))
    },
    { deep: true },
  )
}

export function clearLocalDraft(key: string) {
  if (typeof window === 'undefined')
    return

  window.localStorage.removeItem(key)
}
