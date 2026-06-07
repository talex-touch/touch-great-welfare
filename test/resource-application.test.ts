import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

describe('resource application platform rules', async () => {
  const {
    aggregateResourceApplicationStatus,
    canApplyResourceType,
    RESOURCE_TYPE_CONFIGS,
    termsForResourceTypes,
  } = await import('../src/composables/welfare')

  it('provides static resource type configuration for first-phase resources', () => {
    expect(RESOURCE_TYPE_CONFIGS.map(item => item.resourceType)).toEqual([
      'database',
      'llm_api_quota',
      'git_repository',
      'cicd',
      'vpn',
      'ip_allowlist',
      'server',
      'gpu',
      'k8s_namespace',
      'object_storage',
    ])
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'database')?.subtypes).toEqual(['mysql', 'postgresql', 'redis'])
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'llm_api_quota')?.subtypes).toEqual(['codex', 'gpt-pro'])
  })

  it('marks gated and temporarily unavailable resources', () => {
    const byType = Object.fromEntries(RESOURCE_TYPE_CONFIGS.map(item => [item.resourceType, item]))

    expect(canApplyResourceType(byType.database, 1)).toBe(true)
    expect(canApplyResourceType(byType.llm_api_quota, 1)).toBe(true)

    expect(byType.server.availability).toBe('level_required')
    expect(byType.object_storage.availability).toBe('level_required')
    expect(canApplyResourceType(byType.server, 2)).toBe(false)
    expect(canApplyResourceType(byType.server, 3)).toBe(true)
    expect(canApplyResourceType(byType.object_storage, 2)).toBe(false)
    expect(canApplyResourceType(byType.object_storage, 3)).toBe(true)

    for (const type of ['git_repository', 'cicd', 'vpn', 'ip_allowlist', 'gpu', 'k8s_namespace'] as const) {
      expect(byType[type].availability).toBe('unavailable')
      expect(canApplyResourceType(byType[type], 5)).toBe(false)
    }
  })

  it('automatically merges common and resource-specific terms', () => {
    const terms = termsForResourceTypes(['database', 'llm_api_quota', 'gpu']).map(item => item.id)

    expect(terms).toEqual([
      'general_resource_terms',
      'database_security_terms',
      'llm_api_compliance_terms',
      'infrastructure_resource_terms',
    ])
  })

  it('aggregates item-level approvals into application status', () => {
    expect(aggregateResourceApplicationStatus([])).toBe('draft')
    expect(aggregateResourceApplicationStatus([{ approvalStatus: 'pending' }])).toBe('in_review')
    expect(aggregateResourceApplicationStatus([{ approvalStatus: 'approved' }, { approvalStatus: 'adjusted_approved' }])).toBe('approved')
    expect(aggregateResourceApplicationStatus([{ approvalStatus: 'rejected' }, { approvalStatus: 'rejected' }])).toBe('rejected')
    expect(aggregateResourceApplicationStatus([{ approvalStatus: 'approved' }, { approvalStatus: 'rejected' }])).toBe('partial_approved')
  })
})
