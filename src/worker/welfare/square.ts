import type { ResourceType, SquareBoost, SquarePost, SquareReport, SubmitResourceApplicationPayload, WelfareApplication, WelfareState } from '~/shared/welfare-types'

type RichTextSanitizer = (value: unknown) => string

export function ensureSquarePosts(state: Partial<WelfareState>) {
  state.squarePosts ??= []
  return state.squarePosts
}

export function ensureSquareBoosts(state: Partial<WelfareState>) {
  state.squareBoosts ??= []
  return state.squareBoosts as SquareBoost[]
}

export function ensureSquareReports(state: Partial<WelfareState>) {
  state.squareReports ??= []
  return state.squareReports as SquareReport[]
}

function publicResourceItemPayload(payload: Record<string, any>) {
  const { attachments: _attachments, ...publicPayload } = payload
  return publicPayload
}

export function buildResourceSquarePost(
  application: WelfareApplication,
  payload: SubmitResourceApplicationPayload,
  actualResourceTypes: ResourceType[],
  squarePostId: string,
  createdAt: string,
  sanitizeRichText: RichTextSanitizer,
): SquarePost {
  return {
    id: squarePostId,
    userId: application.userId,
    type: 'application_template',
    title: application.title,
    content: sanitizeRichText(payload.squarePostContent || payload.reason),
    applicationId: application.id,
    requestType: 'resource',
    template: {
      title: application.title,
      departmentId: payload.departmentId,
      projectId: payload.projectId,
      reason: payload.reason,
      businessBackground: payload.businessBackground,
      urgency: payload.urgency,
      expectedEffectiveAt: payload.expectedEffectiveAt,
      costCenter: payload.costCenter,
      ownerId: payload.ownerId,
      duration: payload.duration,
      selectedResourceTypes: actualResourceTypes,
      resourceItems: payload.resourceItems.map(item => ({
        resourceType: item.resourceType,
        resourceSubtype: item.resourceSubtype,
        payload: publicResourceItemPayload(item.payload),
        requestedQuota: item.requestedQuota,
        requestedPermission: item.requestedPermission,
        duration: item.duration,
      })),
      acceptedTermIds: payload.acceptedTermIds,
    },
    createdAt,
    updatedAt: createdAt,
  }
}
