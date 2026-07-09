export function parsePositiveIntegerParam(value: string | null, fallback: number, max: number) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0)
    return fallback
  return Math.min(parsed, max)
}

export function parseOffsetParam(value: string | null) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function parseStatusParam(value: string | null) {
  if (!value)
    return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
