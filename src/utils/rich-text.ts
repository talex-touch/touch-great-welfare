const ALLOWED_TAGS = new Set([
  'A',
  'B',
  'BLOCKQUOTE',
  'BR',
  'DIV',
  'EM',
  'H3',
  'H4',
  'LI',
  'OL',
  'P',
  'STRONG',
  'U',
  'UL',
])

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function sanitizeHref(value: string) {
  const trimmed = value.trim()
  if (/^(?:https?:|mailto:)/i.test(trimmed))
    return trimmed

  return ''
}

function unwrapElement(element: Element) {
  const parent = element.parentNode
  if (!parent)
    return

  while (element.firstChild)
    parent.insertBefore(element.firstChild, element)

  parent.removeChild(element)
}

export function sanitizeRichText(value = '') {
  if (typeof document === 'undefined')
    return escapeHtml(value)

  const template = document.createElement('template')
  template.innerHTML = value

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT)
  const elements: Element[] = []
  while (walker.nextNode())
    elements.push(walker.currentNode as Element)

  for (const element of elements) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      unwrapElement(element)
      continue
    }

    for (const attr of Array.from(element.attributes))
      element.removeAttribute(attr.name)

    if (element.tagName === 'A') {
      const href = sanitizeHref((element as HTMLAnchorElement).href)
      if (href) {
        element.setAttribute('href', href)
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noreferrer')
      }
      else {
        unwrapElement(element)
      }
    }
  }

  return template.innerHTML
}

export function richTextToPlainText(value = '') {
  if (typeof document === 'undefined')
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  const container = document.createElement('div')
  container.innerHTML = sanitizeRichText(value)
  return container.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

export function isRichTextEmpty(value = '') {
  return !richTextToPlainText(value)
}
