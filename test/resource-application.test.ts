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
    normalizeResourceItems,
    RESOURCE_POOL_CATEGORIES,
    RESOURCE_TYPE_CONFIGS,
    termsForResourceTypes,
  } = await import('../src/composables/welfare')

  it('provides static resource type configuration for first-phase resources', () => {
    expect(RESOURCE_TYPE_CONFIGS.map(item => item.resourceType)).toEqual([
      'database',
      'llm_api_quota',
      'content_service',
      'media_publishing',
      'data_productivity',
      'quality_review',
      'git_repository',
      'cicd',
      'vpn',
      'ip_allowlist',
      'notification_channel',
      'identity_security',
      'server',
      'gpu',
      'k8s_namespace',
      'object_storage',
    ])
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'database')?.subtypes).toEqual([
      'mysql',
      'postgresql',
      'redis',
      'mongodb',
      'clickhouse',
      'elasticsearch',
      'opensearch',
      'meilisearch',
      'sqlite',
      'database_instance_access',
    ])
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'llm_api_quota')?.subtypes).toEqual([
      'codex',
      'gpt-pro',
      'gpt-models',
      'claude-code',
      'deepseek',
      'openai-image',
      'seedance',
      'gemini-image',
    ])
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'content_service')?.subtypes).toEqual([
      'resume_polish',
      'cover_letter',
      'interview_coaching',
      'application_statement',
      'ppt_deck',
      'document_polish',
      'translation_localization',
      'technical_writing',
      'prompt_workflow',
    ])
    expect(RESOURCE_TYPE_CONFIGS.find(item => item.resourceType === 'media_publishing')?.subtypes).toEqual([
      'image_publish',
      'poster_design',
      'social_post_publish',
      'video_publish',
      'thumbnail_cover',
      'asset_cleanup',
      'brand_asset',
      'content_moderation',
    ])
  })

  it('marks gated and temporarily unavailable resources', () => {
    const byType = Object.fromEntries(RESOURCE_TYPE_CONFIGS.map(item => [item.resourceType, item]))

    expect(canApplyResourceType(byType.database, 1)).toBe(true)
    expect(canApplyResourceType(byType.llm_api_quota, 1)).toBe(true)
    expect(canApplyResourceType(byType.content_service, 1)).toBe(true)
    expect(canApplyResourceType(byType.media_publishing, 1)).toBe(true)

    expect(byType.server.availability).toBe('level_required')
    expect(byType.object_storage.availability).toBe('level_required')
    expect(canApplyResourceType(byType.server, 2)).toBe(false)
    expect(canApplyResourceType(byType.server, 3)).toBe(true)
    expect(canApplyResourceType(byType.object_storage, 2)).toBe(false)
    expect(canApplyResourceType(byType.object_storage, 3)).toBe(true)

    for (const type of ['data_productivity', 'quality_review', 'git_repository', 'cicd', 'vpn', 'ip_allowlist', 'notification_channel', 'identity_security', 'gpu', 'k8s_namespace'] as const) {
      expect(byType[type].availability).toBe('unavailable')
      expect(canApplyResourceType(byType[type], 5)).toBe(false)
    }
  })

  it('maintains a categorized internal resource pool for the selector', () => {
    expect(RESOURCE_POOL_CATEGORIES.map(item => item.id)).toEqual([
      'database_and_cache',
      'ai_models',
      'content_services',
      'media_publishing',
      'data_productivity',
      'quality_review',
      'cloud_compute',
      'devops_delivery',
      'network_access',
      'notification_communication',
      'identity_security',
    ])
    expect(RESOURCE_POOL_CATEGORIES.find(item => item.id === 'database_and_cache')?.items.map(item => item.id)).toEqual([
      'database:mysql',
      'database:postgresql',
      'database:redis',
      'database:mongodb',
      'database:clickhouse',
      'database:elasticsearch',
      'database:opensearch',
      'database:meilisearch',
      'database:sqlite',
      'database:database_instance_access',
    ])
    expect(RESOURCE_POOL_CATEGORIES.find(item => item.id === 'ai_models')?.items.map(item => item.resourceSubtype)).toEqual([
      'codex',
      'claude-code',
      'gpt-models',
      'gpt-pro',
      'deepseek',
      'openai-image',
      'seedance',
      'gemini-image',
    ])
    expect(RESOURCE_POOL_CATEGORIES.find(item => item.id === 'content_services')?.items.map(item => item.resourceSubtype)).toEqual([
      'resume_polish',
      'cover_letter',
      'interview_coaching',
      'application_statement',
      'ppt_deck',
      'document_polish',
      'translation_localization',
      'technical_writing',
      'prompt_workflow',
    ])
    expect(RESOURCE_POOL_CATEGORIES.find(item => item.id === 'media_publishing')?.items.map(item => item.resourceSubtype)).toEqual([
      'image_publish',
      'poster_design',
      'social_post_publish',
      'video_publish',
      'thumbnail_cover',
      'asset_cleanup',
      'brand_asset',
      'content_moderation',
    ])
  })

  it('automatically merges common and resource-specific terms', () => {
    const terms = termsForResourceTypes(['database', 'llm_api_quota', 'content_service', 'gpu']).map(item => item.id)

    expect(terms).toEqual([
      'general_resource_terms',
      'database_security_terms',
      'llm_api_compliance_terms',
      'creative_service_terms',
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

  it('keeps attachments on each normalized resource item', () => {
    const [item] = normalizeResourceItems('app_1', [{
      resourceType: 'database',
      resourceSubtype: 'postgresql',
      payload: {
        name: 'demo_db',
        attachments: [
          { id: 'att_1', name: 'schema.png', size: 128, type: 'image/png', url: '/api/uploads/images/schema.png' },
          { id: 'att_2', name: 'external.png', size: 256, type: 'image/png', url: 'https://example.com/external.png' },
        ],
      },
    }], '2026-06-09T00:00:00.000Z', false)

    expect(item.payload.attachments).toEqual([
      { id: 'att_1', name: 'schema.png', size: 128, type: 'image/png', r2Key: undefined, url: '/api/uploads/images/schema.png', dataUrl: undefined },
      { id: 'att_2', name: 'external.png', size: 256, type: 'image/png', r2Key: undefined, url: undefined, dataUrl: undefined },
    ])
  })
})
