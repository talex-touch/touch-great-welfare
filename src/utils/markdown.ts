import { sanitizeRichText } from './rich-text'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function sanitizeUrl(value: string, allowMailto = true) {
  const trimmed = value.trim()
  const pattern = allowMailto ? /^(?:https?:|mailto:)/i : /^https?:/i
  return pattern.test(trimmed) ? trimmed : ''
}

function isAttachmentUrl(value: string) {
  return /^(?:attachment|附件):/i.test(value.trim())
}

function renderBasicInline(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
}

function renderInline(value: string) {
  const linkPattern = /(!?)\[([^\]]+)\]\(([^)]+)\)/g
  let output = ''
  let lastIndex = 0
  for (const match of value.matchAll(linkPattern)) {
    const [source, imageMarker, label, url] = match
    output += renderBasicInline(value.slice(lastIndex, match.index))

    if (isAttachmentUrl(url)) {
      output += `<strong>${imageMarker ? '🖼️ 图片附件' : '📎 附件'}：</strong>${escapeHtml(label)}`
    }
    else if (imageMarker) {
      const src = sanitizeUrl(url, false)
      output += src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">` : renderBasicInline(source)
    }
    else {
      const href = sanitizeUrl(url)
      output += href ? `<a href="${escapeHtml(href)}">${renderBasicInline(label)}</a>` : renderBasicInline(source)
    }

    lastIndex = match.index + source.length
  }

  output += renderBasicInline(value.slice(lastIndex))
  return output
}

function splitMarkerContent(value: string, markerLength: number) {
  const content = value.slice(markerLength)
  if (!content || !/^\s/.test(content[0]))
    return ''

  return content.trim()
}

function parseHeading(value: string) {
  const marker = value.match(/^#{1,4}/)?.[0]
  if (!marker)
    return undefined

  const content = splitMarkerContent(value, marker.length)
  if (!content)
    return undefined

  return {
    tag: marker.length <= 2 ? 'h3' : 'h4',
    content,
  }
}

function parseUnorderedItem(value: string) {
  if (!value.startsWith('-') && !value.startsWith('*'))
    return ''

  return splitMarkerContent(value, 1)
}

function parseOrderedItem(value: string) {
  const dotIndex = value.indexOf('.')
  if (dotIndex <= 0)
    return ''

  const marker = value.slice(0, dotIndex)
  if (!/^\d+$/.test(marker))
    return ''

  return splitMarkerContent(value, dotIndex + 1)
}

function parseQuote(value: string) {
  if (!value.startsWith('>'))
    return ''

  return splitMarkerContent(value, 1)
}

function flushList(html: string[], listTag: 'ul' | 'ol' | undefined, items: string[]) {
  if (!listTag || !items.length)
    return

  html.push(`<${listTag}>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${listTag}>`)
  items.length = 0
}

function flushParagraph(html: string[], paragraph: string[]) {
  if (!paragraph.length)
    return

  html.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  paragraph.length = 0
}

export function markdownToHtml(value = '') {
  const html: string[] = []
  const paragraph: string[] = []
  const listItems: string[] = []
  let activeListTag: 'ul' | 'ol' | undefined

  for (const line of value.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph(html, paragraph)
      flushList(html, activeListTag, listItems)
      activeListTag = undefined
      continue
    }

    const headingMatch = parseHeading(trimmed)
    if (headingMatch) {
      flushParagraph(html, paragraph)
      flushList(html, activeListTag, listItems)
      activeListTag = undefined
      html.push(`<${headingMatch.tag}>${renderInline(headingMatch.content)}</${headingMatch.tag}>`)
      continue
    }

    const unordered = parseUnorderedItem(trimmed)
    if (unordered) {
      flushParagraph(html, paragraph)
      if (activeListTag && activeListTag !== 'ul')
        flushList(html, activeListTag, listItems)
      activeListTag = 'ul'
      listItems.push(unordered)
      continue
    }

    const ordered = parseOrderedItem(trimmed)
    if (ordered) {
      flushParagraph(html, paragraph)
      if (activeListTag && activeListTag !== 'ol')
        flushList(html, activeListTag, listItems)
      activeListTag = 'ol'
      listItems.push(ordered)
      continue
    }

    const quote = parseQuote(trimmed)
    if (quote) {
      flushParagraph(html, paragraph)
      flushList(html, activeListTag, listItems)
      activeListTag = undefined
      html.push(`<blockquote>${renderInline(quote)}</blockquote>`)
      continue
    }

    flushList(html, activeListTag, listItems)
    activeListTag = undefined
    paragraph.push(trimmed)
  }

  flushParagraph(html, paragraph)
  flushList(html, activeListTag, listItems)

  return html.join('')
}

export function markdownToSafeHtml(value = '') {
  const html = markdownToHtml(value)
  return typeof document === 'undefined' ? html : sanitizeRichText(html)
}
