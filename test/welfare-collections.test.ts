import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ state: {} }), {
    headers: { 'content-type': 'application/json' },
  }),
))

const {
  appendWorkerApplicationMessage,
  buildResourceDescription,
  ensureApplications,
  manualProvisionNote,
  normalizeManualProvisionPayload,
} = await import('../src/worker/welfare/applications')
const { ensureCoupons } = await import('../src/worker/welfare/coupons')
const { ensureSquareBoosts, ensureSquarePosts, ensureSquareReports } = await import('../src/worker/welfare/square')
const { ensureCollaborationApplications, ensureDailyCheckIns, ensureInvitationBindings } = await import('../src/worker/welfare/users')
const { ensureStudentVerifications } = await import('../src/worker/welfare/verifications')

describe('welfare collection helpers', () => {
  it('initializes missing domain collections as arrays', () => {
    const state: Record<string, unknown> = {}

    expect(ensureApplications(state)).toEqual([])
    expect(ensureCoupons(state)).toEqual([])
    expect(ensureSquarePosts(state)).toEqual([])
    expect(ensureSquareBoosts(state)).toEqual([])
    expect(ensureSquareReports(state)).toEqual([])
    expect(ensureDailyCheckIns(state)).toEqual([])
    expect(ensureInvitationBindings(state)).toEqual([])
    expect(ensureCollaborationApplications(state)).toEqual([])
    expect(ensureStudentVerifications(state)).toEqual([])
  })

  it('preserves existing collection references', () => {
    const applications = [{ id: 'app_1' }]
    const state: Record<string, unknown> = { applications }

    expect(ensureApplications(state)).toBe(applications)
  })

  it('builds sanitized resource descriptions from reason before business background', () => {
    const sanitized = buildResourceDescription({
      reason: '<script>bad()</script><p> 申请理由 </p>',
      businessBackground: '<p>业务背景</p>',
    } as never, value => String(value).replace(/<script>.*?<\/script>/g, '').trim())

    expect(sanitized).toBe('<p> 申请理由 </p>')
  })

  it('normalizes manual provision payloads and notes', () => {
    const payload = normalizeManualProvisionPayload({
      resourceName: '  PostgreSQL  ',
      resourceType: ' database ',
      accessUrl: ' https://db.example ',
      credential: '',
      expiresAt: '2026-07-01',
      note: ' 只读账号 ',
    })

    expect(payload).toEqual({
      resourceName: 'PostgreSQL',
      resourceType: 'database',
      accessUrl: 'https://db.example',
      credential: '',
      expiresAt: '2026-07-01',
      note: '只读账号',
    })
    expect(manualProvisionNote(payload)).toBe([
      '资源：PostgreSQL',
      '类型：database',
      '访问地址：https://db.example',
      '有效期：2026-07-01',
      '备注：只读账号',
    ].join('\n'))
  })

  it('rejects incomplete manual provision payloads', () => {
    expect(() => normalizeManualProvisionPayload({ resourceType: 'database', accessUrl: 'https://db.example' })).toThrow('请填写资源名称')
    expect(() => normalizeManualProvisionPayload({ resourceName: 'PostgreSQL', accessUrl: 'https://db.example' })).toThrow('请选择资源类型')
    expect(() => normalizeManualProvisionPayload({ resourceName: 'PostgreSQL', resourceType: 'database' })).toThrow('请至少填写访问地址或凭据')
  })

  it('appends sanitized worker application messages with bounded attachments', () => {
    const application = { id: 'app_1', messages: [] }
    const result = appendWorkerApplicationMessage(application as never, { id: 'user_1' }, {
      type: 'supplement',
      content: ' <p>补充内容</p> ',
      attachments: [{
        id: 'att_1',
        name: '补充.png',
        size: 1024,
        type: 'image/png',
        r2Key: 'uploads/att_1',
        url: '/api/uploads/att_1/file',
        dataUrl: 'data:image/png;base64,AAAA',
      }],
    }, value => String(value).trim())

    expect(result).toEqual({ applicationId: 'app_1' })
    expect(application.messages).toHaveLength(1)
    expect(application.messages[0]).toMatchObject({
      applicationId: 'app_1',
      userId: 'user_1',
      type: 'supplement',
      content: '<p>补充内容</p>',
      attachments: [{
        id: 'att_1',
        name: '补充.png',
        size: 1024,
        type: 'image/png',
        r2Key: 'uploads/att_1',
        url: '/api/uploads/att_1/file',
        dataUrl: 'data:image/png;base64,AAAA',
      }],
    })
  })

  it('rejects empty worker application messages and oversized attachments', () => {
    const application = { id: 'app_1', messages: [] }

    expect(() => appendWorkerApplicationMessage(application as never, { id: 'user_1' }, {
      content: '   ',
    }, value => String(value).trim())).toThrow('请输入消息内容')

    expect(() => appendWorkerApplicationMessage(application as never, { id: 'user_1' }, {
      content: '<p>补充内容</p>',
      attachments: [{ size: 200 * 1024 * 1024 + 1 }],
    }, value => String(value).trim())).toThrow('附件总大小不能超过 200MB')
  })
})
