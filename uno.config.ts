import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  shortcuts: [
    ['btn', 'px-4 py-2 rounded-full inline-flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 fw-700 cursor-pointer transition hover:bg-emerald-400 disabled:cursor-default disabled:op50'],
    ['icon-btn', 'inline-flex items-center justify-center rounded-full p-2 cursor-pointer select-none opacity-75 transition duration-200 ease-in-out hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'],
    ['field-label', 'text-sm fw-700 text-slate-700 dark:text-slate-200'],
    ['field-hint', 'text-xs leading-relaxed text-slate-500 dark:text-slate-400'],
  ],
  safelist: [
    'i-carbon-code',
    'i-carbon-image',
    'i-carbon-star',
    'i-carbon-checkmark-filled',
    'i-carbon-warning-filled',
    'i-carbon-time',
    'i-carbon-close-filled',
    'i-carbon-logo-github',
    'i-carbon-user-avatar',
    'i-carbon-education',
    'i-carbon-wallet',
    'i-carbon-settings',
    'i-carbon-review',
    'i-carbon-document-attachment',
    'i-carbon-security',
    'i-carbon-dashboard',
    'i-carbon-sun',
    'i-carbon-moon',
  ],
  presets: [
    presetWind4(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: false,
    }),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
})
