import type { WorkerEnv } from './welfare-state'
import type { AttachmentMeta, WelfareState } from '~/composables/welfare'
import { assertWelfareState, createId, errorResponse, getAuthenticatedRequest, json } from './auth'
import { readWelfareState } from './welfare-state'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const UPLOAD_PREFIX = 'user-uploads'

interface UploadResponse {
  id: string
  name: string
  size: number
  type: string
  r2Key: string
  url: string
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[^\w.\-\u4E00-\u9FA5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'image'
}

function isImageContentType(value: string) {
  return value.toLowerCase().startsWith('image/')
}

function extensionFromName(name: string) {
  const match = name.match(/\.([a-z0-9]{1,12})$/i)
  return match ? `.${match[1].toLowerCase()}` : ''
}

function attachmentUrl(id: string) {
  return `/api/uploads/${encodeURIComponent(id)}/file`
}

function r2KeyOwnerId(r2Key: string | undefined) {
  if (!r2Key)
    return ''

  const match = r2Key.match(/^user-uploads\/([^/]+)\//)
  return match?.[1] ?? ''
}

function attachmentBelongsToOwner(file: AttachmentMeta, ownerId: string) {
  return !file.r2Key || r2KeyOwnerId(file.r2Key) === ownerId
}

function attachmentVisibleToUser(file: AttachmentMeta, userId: string, state: WelfareState) {
  const canRead = (itemUserId: string) => itemUserId === userId || state.users.find(item => item.id === userId)?.role === 'admin'
  const matches = (item: AttachmentMeta) => item.id === file.id && item.r2Key === file.r2Key

  for (const application of state.applications) {
    if (!attachmentBelongsToOwner(file, application.userId))
      continue
    if (!canRead(application.userId))
      continue
    if (application.attachments.some(matches))
      return true
    if (application.messages?.some(message => message.attachments.some(matches)))
      return true
  }

  return state.studentVerifications.some(verification => attachmentBelongsToOwner(file, verification.userId) && canRead(verification.userId) && verification.attachments.some(matches))
}

function findAttachment(state: WelfareState, fileId: string) {
  for (const application of state.applications) {
    const applicationFile = application.attachments.find(item => item.id === fileId)
    if (applicationFile)
      return applicationFile

    for (const message of application.messages ?? []) {
      const messageFile = message.attachments.find(item => item.id === fileId)
      if (messageFile)
        return messageFile
    }
  }

  for (const verification of state.studentVerifications) {
    const verificationFile = verification.attachments.find(item => item.id === fileId)
    if (verificationFile)
      return verificationFile
  }

  return undefined
}

async function uploadImage(request: Request, env: WorkerEnv): Promise<UploadResponse> {
  if (!env.AI_ASSETS)
    throw new Error('AI_ASSETS R2 Binding 未配置')

  const auth = await getAuthenticatedRequest(request, env)
  const contentType = request.headers.get('content-type') ?? ''
  if (!isImageContentType(contentType))
    throw new Error('仅支持上传图片资源')

  const size = Number(request.headers.get('content-length') ?? 0)
  if (size > MAX_UPLOAD_BYTES)
    throw new Error('图片大小不能超过 200MB')

  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new Error('图片大小不能超过 200MB')

  const id = createId('att')
  const rawName = decodeURIComponent(request.headers.get('x-file-name') ?? '')
  const name = sanitizeFileName(rawName)
  const r2Key = `${UPLOAD_PREFIX}/${auth.user.id}/${id}${extensionFromName(name)}`

  await env.AI_ASSETS.put(r2Key, bytes, {
    httpMetadata: {
      contentType,
    },
  })

  return {
    id,
    name,
    size: bytes.byteLength,
    type: contentType,
    r2Key,
    url: attachmentUrl(id),
  }
}

async function readUploadedFile(request: Request, env: WorkerEnv, fileId: string) {
  const auth = await getAuthenticatedRequest(request, env)
  const state = await readWelfareState(env) as Partial<WelfareState>
  assertWelfareState(state)

  const file = findAttachment(state, fileId)
  if (!file || !file.r2Key)
    return json({ error: '图片文件不存在' }, 404)
  if (!attachmentVisibleToUser(file, auth.user.id, state))
    return json({ error: '无权读取该图片' }, 403)
  if (!env.AI_ASSETS)
    throw new Error('AI_ASSETS R2 Binding 未配置')

  const object = await env.AI_ASSETS.get(file.r2Key)
  if (!object)
    return json({ error: '图片文件不存在' }, 404)

  return new Response(object.body, {
    headers: {
      'cache-control': 'private, max-age=300',
      'content-type': file.type || object.httpMetadata?.contentType || 'image/*',
    },
  })
}

export async function handleUploadRequest(request: Request, env: WorkerEnv) {
  try {
    const url = new URL(request.url)
    const path = url.pathname.slice('/api/uploads'.length) || '/'

    if (path === '/images' && request.method === 'POST')
      return json(await uploadImage(request, env))

    const fileMatch = path.match(/^\/([^/]+)\/file$/)
    if (fileMatch && request.method === 'GET')
      return readUploadedFile(request, env, decodeURIComponent(fileMatch[1]))

    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    return errorResponse(error)
  }
}
