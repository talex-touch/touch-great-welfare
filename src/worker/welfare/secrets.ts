const MASKED_SECRET_MARKER = '****'

export function maskSecret(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text)
    return ''
  if (text.length <= 8)
    return MASKED_SECRET_MARKER
  return `${text.slice(0, 4)}${MASKED_SECRET_MARKER}${text.slice(-4)}`
}

export function isMaskedSecret(value: unknown) {
  return typeof value === 'string' && value.includes(MASKED_SECRET_MARKER)
}
