import type { WorkerEnv } from './welfare-state'
import { handleAiImageJob, handleResourceProvisionJob } from './ai'
import { handleNotificationJob, isNotificationQueueJob } from './notifications'

export interface AiImageQueueJob {
  type: 'ai.image.generate'
  jobId: string
}

export interface ResourceProvisionQueueJob {
  type: 'resource.provision'
  applicationId: string
  adminUserId: string
  itemId?: string
}

function isResourceProvisionQueueJob(value: unknown): value is ResourceProvisionQueueJob {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === 'resource.provision'
    && typeof (value as Record<string, unknown>).applicationId === 'string'
    && typeof (value as Record<string, unknown>).adminUserId === 'string'
}

function isAiImageQueueJob(value: unknown): value is AiImageQueueJob {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === 'ai.image.generate'
    && typeof (value as Record<string, unknown>).jobId === 'string'
}

export async function handleAsyncJobBatch(batch: MessageBatch<unknown>, env: WorkerEnv) {
  for (const message of batch.messages) {
    try {
      if (isNotificationQueueJob(message.body)) {
        await handleNotificationJob(message.body, env)
        message.ack()
        continue
      }

      if (isAiImageQueueJob(message.body)) {
        await handleAiImageJob(env, message.body.jobId)
        message.ack()
        continue
      }

      if (isResourceProvisionQueueJob(message.body)) {
        await handleResourceProvisionJob(env, message.body)
        message.ack()
        continue
      }

      message.ack()
    }
    catch (error) {
      console.error('async job failed', error)
      message.retry()
    }
  }
}
