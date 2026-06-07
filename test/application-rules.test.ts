import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

describe('application billing rules', async () => {
  const {
    ACTIVITY_END_AT,
    ACTIVITY_START_AT,
    BASE_REQUEST_COST,
    PRO_EXPEDITE_COST,
    calculateActivityPrice,
    calculateApplicationPrepaidCost,
    calculateCodexCostPoints,
    calculateLlmApiBudgetActivityPrice,
    calculateLlmApiCostPoints,
    calculateRejectionReviewFee,
    CODEX_DEFAULT_BUDGET_USD,
    CODEX_EXTENDED_PROCESSING_HOURS,
    CODEX_POINTS_PER_USD,
    CODEX_STANDARD_PROCESSING_HOURS,
    DEFAULT_LLM_API_MODELS,
    createFraudRejectionCooldownUntil,
    createCodexProcessingDueAt,
    createProcessingDueAt,
    createRejectionFeeWaiverBlockedUntil,
    createRetentionExpiresAt,
    defaultLlmApiDuration,
    GPT_PRO_ACTIVITY_DISCOUNT_RATE,
    GPT_PRO_DEFAULT_DURATION,
    GPT_PRO_DEFAULT_ROUNDS,
    GPT_PRO_MODEL_KEY,
    llmApiBudgetActivityDiscountRate,
    llmApiDurationExtensionCost,
  } = await import('../src/composables/welfare')

  it('charges rejected applications with a bounded 30% AI review fee', () => {
    expect(calculateRejectionReviewFee(800)).toBe(300)
    expect(calculateRejectionReviewFee(1200)).toBe(360)
    expect(calculateRejectionReviewFee(3200)).toBe(800)
  })

  it('applies the 7-day 0.1 discount activity to application prices', () => {
    expect(calculateActivityPrice(BASE_REQUEST_COST.pro, ACTIVITY_START_AT)).toBe(120)
    expect(calculateActivityPrice(BASE_REQUEST_COST.pro, ACTIVITY_END_AT)).toBe(12000)
  })

  it('applies tiered activity discounts to LLM API resource budgets', () => {
    const cost99 = calculateLlmApiCostPoints(99)
    const cost100 = calculateLlmApiCostPoints(100)
    const cost300 = calculateLlmApiCostPoints(300)
    const cost500 = calculateLlmApiCostPoints(500)

    expect(calculateLlmApiBudgetActivityPrice(cost99, 99, undefined, ACTIVITY_START_AT)).toBe(Math.ceil(cost99 * 0.01))
    expect(calculateLlmApiBudgetActivityPrice(cost100, 100, undefined, ACTIVITY_START_AT)).toBe(Math.ceil(cost100 * 0.05))
    expect(calculateLlmApiBudgetActivityPrice(cost300, 300, undefined, ACTIVITY_START_AT)).toBe(Math.ceil(cost300 * 0.07))
    expect(calculateLlmApiBudgetActivityPrice(cost500, 500, undefined, ACTIVITY_START_AT)).toBe(cost500)
    expect(calculateLlmApiBudgetActivityPrice(cost500, 500, undefined, ACTIVITY_END_AT)).toBe(cost500)
  })

  it('prices GPT PRO by conversation rounds with a limited 50% activity discount', () => {
    const gptPro = DEFAULT_LLM_API_MODELS.find(item => item.key === GPT_PRO_MODEL_KEY)!
    const baseCost = calculateLlmApiCostPoints(GPT_PRO_DEFAULT_ROUNDS, gptPro)

    expect(gptPro.defaultBudgetUsd).toBe(GPT_PRO_DEFAULT_ROUNDS)
    expect(baseCost).toBe(BASE_REQUEST_COST.pro * GPT_PRO_DEFAULT_ROUNDS)
    expect(llmApiBudgetActivityDiscountRate(GPT_PRO_DEFAULT_ROUNDS, gptPro)).toBe(GPT_PRO_ACTIVITY_DISCOUNT_RATE)
    expect(calculateLlmApiBudgetActivityPrice(baseCost, GPT_PRO_DEFAULT_ROUNDS, gptPro, ACTIVITY_START_AT)).toBe(Math.ceil(baseCost * GPT_PRO_ACTIVITY_DISCOUNT_RATE))
    expect(defaultLlmApiDuration(gptPro)).toBe(GPT_PRO_DEFAULT_DURATION)
    expect(llmApiDurationExtensionCost(GPT_PRO_DEFAULT_DURATION, gptPro)).toBe(0)
    expect(llmApiDurationExtensionCost('30 天', gptPro)).toBeGreaterThan(0)
  })

  it('includes storage and expedited processing in prepaid cost', () => {
    expect(calculateApplicationPrepaidCost('pro', true, true, ACTIVITY_START_AT)).toBe(120 + 300 + PRO_EXPEDITE_COST)
  })

  it('calculates codex budget with accelerated growth after 100 USD', () => {
    expect(calculateCodexCostPoints(CODEX_DEFAULT_BUDGET_USD)).toBeGreaterThanOrEqual(CODEX_DEFAULT_BUDGET_USD * 10)
    expect(calculateCodexCostPoints(100)).toBe(1200)
    expect(calculateCodexCostPoints(1000)).toBeGreaterThan(1000 * CODEX_POINTS_PER_USD)
  })

  it('extends retention by another 7 days when storage service is selected', () => {
    const createdAt = '2026-06-01T00:00:00.000Z'

    expect(createRetentionExpiresAt(createdAt, false)).toBe('2026-06-08T00:00:00.000Z')
    expect(createRetentionExpiresAt(createdAt, true)).toBe('2026-06-15T00:00:00.000Z')
  })

  it('blocks fee-waiver opt-in for 3 days after a waived rejection', () => {
    const reviewedAt = '2026-06-01T00:00:00.000Z'

    expect(createRejectionFeeWaiverBlockedUntil(reviewedAt)).toBe('2026-06-04T00:00:00.000Z')
  })

  it('blocks same-type applications for 7 days after fraudulent rejection', () => {
    const reviewedAt = '2026-06-01T00:00:00.000Z'

    expect(createFraudRejectionCooldownUntil(reviewedAt)).toBe('2026-06-08T00:00:00.000Z')
  })

  it('creates processing due dates for codex and pro requests', () => {
    const createdAt = '2026-06-01T00:00:00.000Z'

    expect(createCodexProcessingDueAt(createdAt, 10)).toBe('2026-06-02T00:00:00.000Z')
    expect(createCodexProcessingDueAt(createdAt, 110)).toBe('2026-06-04T00:00:00.000Z')
    expect(CODEX_STANDARD_PROCESSING_HOURS).toBe(24)
    expect(CODEX_EXTENDED_PROCESSING_HOURS).toBe(72)
    expect(createProcessingDueAt(createdAt, 'pro', false)).toBe('2026-06-04T00:00:00.000Z')
    expect(createProcessingDueAt(createdAt, 'pro', true)).toBe('2026-06-03T00:00:00.000Z')
    expect(createProcessingDueAt(createdAt, 'image', true)).toBeUndefined()
  })
})
