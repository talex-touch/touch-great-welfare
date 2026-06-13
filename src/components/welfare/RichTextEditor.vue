<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { sanitizeRichText } from '~/utils/rich-text'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  minHeight?: number
}>(), {
  placeholder: '请输入内容',
  minHeight: 180,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLElement>()
const linkUrl = ref('')
const isLinkPromptOpen = ref(false)
const isFocused = ref(false)

type MarkdownShortcutRule = { kind: 'block', tag: 'h3' | 'h4' | 'blockquote' } | { kind: 'list', tag: 'ul' | 'ol' }

const editorStyle = computed(() => ({
  minHeight: `${props.minHeight}px`,
}))

function clipboardImageFiles(event: ClipboardEvent) {
  return Array.from(event.clipboardData?.items ?? [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file)
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result || '')))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function insertHtml(html: string) {
  document.execCommand('insertHTML', false, sanitizeRichText(html))
  emitEditorHtml()
}

function selectionInEditor() {
  const editor = editorRef.value
  const selection = window.getSelection()
  if (!editor || !selection || selection.rangeCount === 0 || !selection.isCollapsed)
    return null

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer))
    return null

  return { editor, range, selection }
}

function closestEditableBlock(node: Node, editor: HTMLElement) {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode
  while (current && current !== editor) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement
      if (['P', 'DIV', 'H3', 'H4', 'BLOCKQUOTE', 'LI'].includes(element.tagName))
        return element
    }
    current = current.parentNode
  }
  return editor
}

function textBeforeCaretInBlock(range: Range, block: HTMLElement, editor: HTMLElement) {
  if (block === editor && range.startContainer.nodeType === Node.TEXT_NODE)
    return range.startContainer.textContent?.slice(0, range.startOffset) ?? ''

  const textRange = document.createRange()
  textRange.selectNodeContents(block)
  textRange.setEnd(range.startContainer, range.startOffset)
  return textRange.toString()
}

function markdownShortcutRule(marker: string): MarkdownShortcutRule | null {
  if (marker === '#')
    return { kind: 'block', tag: 'h3' }
  if (marker === '##' || marker === '###')
    return { kind: 'block', tag: 'h4' }
  if (marker === '>')
    return { kind: 'block', tag: 'blockquote' }
  if (marker === '-' || marker === '*')
    return { kind: 'list', tag: 'ul' }
  if (/^\d+\.$/.test(marker))
    return { kind: 'list', tag: 'ol' }
  return null
}

function removeShortcutMarker(range: Range, marker: string) {
  if (range.startContainer.nodeType !== Node.TEXT_NODE || range.startOffset < marker.length)
    return false

  const textNode = range.startContainer
  const text = textNode.textContent ?? ''
  const markerStart = range.startOffset - marker.length
  if (text.slice(markerStart, range.startOffset) !== marker)
    return false

  textNode.textContent = `${text.slice(0, markerStart)}${text.slice(range.startOffset)}`
  const nextRange = document.createRange()
  nextRange.setStart(textNode, markerStart)
  nextRange.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(nextRange)
  return true
}

function isEmptyElement(element: HTMLElement) {
  return !element.textContent?.trim() && !element.querySelector('img')
}

function ensureEditableContent(element: HTMLElement) {
  if (!element.childNodes.length || isEmptyElement(element))
    element.innerHTML = '<br>'
}

function placeCaretAtStart(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function replaceCurrentBlock(block: HTMLElement, editor: HTMLElement, replacement: HTMLElement) {
  if (block === editor) {
    const selection = window.getSelection()
    const currentNode = selection?.anchorNode
    if (currentNode && currentNode.parentNode === editor) {
      editor.insertBefore(replacement, currentNode)
      currentNode.parentNode?.removeChild(currentNode)
    }
    else {
      editor.appendChild(replacement)
    }
    return
  }

  while (block.firstChild)
    replacement.appendChild(block.firstChild)
  block.replaceWith(replacement)
}

function replaceCurrentBlockWithList(block: HTMLElement, editor: HTMLElement, tag: 'ul' | 'ol') {
  const list = document.createElement(tag)
  const item = document.createElement('li')
  if (block !== editor) {
    while (block.firstChild)
      item.appendChild(block.firstChild)
  }
  ensureEditableContent(item)
  list.appendChild(item)

  if (block === editor)
    editor.appendChild(list)
  else
    block.replaceWith(list)

  placeCaretAtStart(item)
}

function applyMarkdownShortcut(rule: MarkdownShortcutRule, block: HTMLElement, editor: HTMLElement) {
  if (rule.kind === 'block') {
    const replacement = document.createElement(rule.tag)
    replaceCurrentBlock(block, editor, replacement)
    ensureEditableContent(replacement)
    placeCaretAtStart(replacement)
    return
  }

  replaceCurrentBlockWithList(block, editor, rule.tag)
}

function maybeApplyMarkdownShortcut() {
  const state = selectionInEditor()
  if (!state)
    return false

  const { editor, range } = state
  const block = closestEditableBlock(range.startContainer, editor)
  const marker = textBeforeCaretInBlock(range, block, editor)
  const rule = markdownShortcutRule(marker)
  if (!rule || !removeShortcutMarker(range, marker))
    return false

  applyMarkdownShortcut(rule, block, editor)
  emitEditorHtml()
  return true
}

function syncEditorHtml(value = props.modelValue) {
  const editor = editorRef.value
  if (!editor || isFocused.value)
    return

  const sanitized = sanitizeRichText(value)
  if (editor.innerHTML !== sanitized)
    editor.innerHTML = sanitized
}

function emitEditorHtml() {
  const sanitized = sanitizeRichText(editorRef.value?.innerHTML ?? '')
  emit('update:modelValue', sanitized)
}

function runCommand(command: string, value?: string) {
  editorRef.value?.focus()
  document.execCommand(command, false, value)
  emitEditorHtml()
}

function setBlock(tag: 'p' | 'h3' | 'blockquote') {
  runCommand('formatBlock', tag)
}

function addLink() {
  isLinkPromptOpen.value = true
  linkUrl.value = ''
}

function confirmLink() {
  const href = linkUrl.value
  isLinkPromptOpen.value = false
  if (!href)
    return

  if (!/^(?:https?:|mailto:)/i.test(href.trim()))
    return

  runCommand('createLink', href.trim())
}

function cancelLink() {
  isLinkPromptOpen.value = false
  linkUrl.value = ''
}

async function onPaste(event: ClipboardEvent) {
  event.preventDefault()
  const imageFiles = clipboardImageFiles(event)
  if (imageFiles.length) {
    const imageHtml = (await Promise.all(imageFiles.map(fileToDataUrl)))
      .map((src, index) => `<p><img src="${src}" alt="粘贴图片 ${index + 1}"></p>`)
      .join('')
    insertHtml(imageHtml)
    return
  }

  const html = event.clipboardData?.getData('text/html')
  const text = event.clipboardData?.getData('text/plain') ?? ''
  insertHtml(html || text.replace(/\n/g, '<br>'))
}

function onFocus() {
  isFocused.value = true
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== ' ')
    return

  if (maybeApplyMarkdownShortcut())
    event.preventDefault()
}

function onBlur() {
  isFocused.value = false
  emitEditorHtml()
  nextTick(() => syncEditorHtml())
}

watch(() => props.modelValue, value => syncEditorHtml(value))

onMounted(() => syncEditorHtml())
</script>

<template>
  <div class="rich-editor">
    <div class="rich-editor-toolbar" aria-label="编辑工具栏">
      <button type="button" title="正文" @click="setBlock('p')">
        <span class="i-carbon-paragraph" />
      </button>
      <button type="button" title="小标题" @click="setBlock('h3')">
        <span class="i-carbon-text-font" />
      </button>
      <button type="button" title="加粗" @click="runCommand('bold')">
        <span class="i-carbon-text-bold" />
      </button>
      <button type="button" title="下划线" @click="runCommand('underline')">
        <span class="i-carbon-text-underline" />
      </button>
      <button type="button" title="项目列表" @click="runCommand('insertUnorderedList')">
        <span class="i-carbon-list-bulleted" />
      </button>
      <button type="button" title="编号列表" @click="runCommand('insertOrderedList')">
        <span class="i-carbon-list-numbered" />
      </button>
      <button type="button" title="引用" @click="setBlock('blockquote')">
        <span class="i-carbon-quotes" />
      </button>
      <button type="button" title="链接" @click="addLink">
        <span class="i-carbon-link" />
      </button>
      <button type="button" title="清除格式" @click="runCommand('removeFormat')">
        <span class="i-carbon-clean" />
      </button>
    </div>

    <div class="rich-editor-body">
      <div
        ref="editorRef"
        class="rich-editor-surface"
        :class="{ 'is-empty': !modelValue }"
        :data-placeholder="placeholder"
        :style="editorStyle"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
        @input="emitEditorHtml"
        @paste="onPaste"
      />
    </div>

    <div v-if="isLinkPromptOpen" class="rich-link-popover">
      <input v-model="linkUrl" type="url" placeholder="https://example.com 或 mailto:name@example.com" @keydown.enter.prevent="confirmLink" @keydown.esc.prevent="cancelLink">
      <button type="button" @click="confirmLink">
        应用
      </button>
      <button type="button" @click="cancelLink">
        取消
      </button>
    </div>
  </div>
</template>
