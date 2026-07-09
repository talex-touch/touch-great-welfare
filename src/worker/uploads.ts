import type { WorkerEnv } from './welfare-state'
import type { AttachmentMeta, WelfareState } from '~/shared/welfare-types'
import { assertWelfareState, createId, errorResponse, getAuthenticatedRequest, json } from './auth'
import { readWelfareStateRecord } from './welfare-state'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const UPLOAD_PREFIX = 'user-uploads'

class UploadRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function requestContentLength(request: Request) {
  const value = request.headers.get('content-length')
  if (!value)
    throw new UploadRequestError('缺少图片大小信息', 400)

  const size = Math.trunc(Number(value))
  if (!Number.isFinite(size) || size < 0)
    throw new UploadRequestError('图片大小信息无效', 400)

  return size
}

function limitedBodyStream(request: Request, maxBytes: number) {
  const body = request.body
  if (!body)
    throw new UploadRequestError('上传内容不能为空', 400)

  let totalBytes = 0
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      totalBytes += chunk.byteLength
      if (totalBytes > maxBytes)
        throw new UploadRequestError('图片大小不能超过 200MB', 413)

      controller.enqueue(chunk)
    },
  }))
}

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

function attachmentItems(value: { attachments?: AttachmentMeta[] }) {
  return Array.isArray(value.attachments) ? value.attachments : []
}

function attachmentVisibleToUser(file: AttachmentMeta, userId: string, state: WelfareState, isAdmin: boolean) {
  const canRead = (itemUserId: string) => itemUserId === userId || isAdmin
  const matches = (item: AttachmentMeta) => item.id === file.id && item.r2Key === file.r2Key

  for (const application of state.applications) {
    if (!attachmentBelongsToOwner(file, application.userId))
      continue
    if (!canRead(application.userId))
      continue
    if (attachmentItems(application).some(matches))
      return true
    if (application.messages?.some(message => attachmentItems(message).some(matches)))
      return true
  }

  return state.studentVerifications.some(verification => attachmentBelongsToOwner(file, verification.userId) && canRead(verification.userId) && attachmentItems(verification).some(matches))
}

function findAttachment(state: WelfareState, fileId: string) {
  for (const application of state.applications) {
    const applicationFile = attachmentItems(application).find(item => item.id === fileId)
    if (applicationFile)
      return applicationFile

    for (const message of application.messages ?? []) {
      const messageFile = attachmentItems(message).find(item => item.id === fileId)
      if (messageFile)
        return messageFile
    }
  }

  for (const verification of state.studentVerifications) {
    const verificationFile = attachmentItems(verification).find(item => item.id === fileId)
    if (verificationFile)
      return verificationFile
  }

  return undefined
}

async function uploadImage(request: Request, env: WorkerEnv): Promise<UploadResponse> {
  const auth = await getAuthenticatedRequest(request, env)

  if (!env.AI_ASSETS)
    throw new Error('AI_ASSETS R2 Binding 未配置')

  const contentType = request.headers.get('content-type') ?? ''
  if (!isImageContentType(contentType))
    throw new UploadRequestError('仅支持上传图片资源', 400)

  const size = requestContentLength(request)
  if (size > MAX_UPLOAD_BYTES)
    throw new UploadRequestError('图片大小不能超过 200MB', 413)

  const body = limitedBodyStream(request, MAX_UPLOAD_BYTES)

  const id = createId('att')
  const rawName = decodeURIComponent(request.headers.get('x-file-name') ?? '')
  const name = sanitizeFileName(rawName)
  const r2Key = `${UPLOAD_PREFIX}/${auth.user.id}/${id}${extensionFromName(name)}`

  await env.AI_ASSETS.put(r2Key, body, {
    httpMetadata: {
      contentType,
    },
  })

  return {
    id,
    name,
    size,
    type: contentType,
    r2Key,
    url: attachmentUrl(id),
  }
}

async function readUploadedFile(request: Request, env: WorkerEnv, fileId: string) {
  const auth = await getAuthenticatedRequest(request, env)
  const state = (await readWelfareStateRecord(env)).state as Partial<WelfareState>
  assertWelfareState(state)

  const file = findAttachment(state, fileId)
  if (!file || !file.r2Key)
    return json({ error: '图片文件不存在' }, 404)
  if (!attachmentVisibleToUser(file, auth.user.id, state, auth.user.role === 'admin'))
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
      return await readUploadedFile(request, env, decodeURIComponent(fileMatch[1]))

    return json({ error: 'Not Found' }, 404)
  }
  catch (error) {
    if (error instanceof UploadRequestError)
      return errorResponse(error, error.status)

    return errorResponse(error)
  }
}
