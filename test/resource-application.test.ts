import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

describe('resource application platform rules', async () => {
  const {
    aggregateResourceApplicationStatus,
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
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'llm_api_quota')?.subtypes).toContain('deepseek')
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'llm_api_quota')?.subtypes).toContain('openai')
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
