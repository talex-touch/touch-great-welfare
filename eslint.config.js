import antfu from '@antfu/eslint-config'

export default antfu(
  {
    unocss: true,
    formatters: true,
    pnpm: true,
    ignores: [
      '.codexpotter/**',
      '.pi/**',
      '.playwright-mcp/**',
      '.spec-workflow/**',
      '**/*.md',
    ],
  },
)
