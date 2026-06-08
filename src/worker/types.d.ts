interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement
  first: <T = unknown>() => Promise<T | null>
  run: () => Promise<unknown>
  all: <T = unknown>() => Promise<{ results: T[] }>
}

interface D1Database {
  exec: (query: string) => Promise<unknown>
  prepare: (query: string) => D1PreparedStatement
}

interface Queue<T = unknown> {
  send: (message: T) => Promise<void>
}

interface Message<T = unknown> {
  body: T
  ack: () => void
  retry: () => void
}

interface MessageBatch<T = unknown> {
  messages: Message<T>[]
}

interface R2ObjectBody {
  body: ReadableStream
  httpMetadata?: {
    contentType?: string
  }
}

interface R2Bucket {
  put: (
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: {
        contentType?: string
      }
    },
  ) => Promise<unknown>
  get: (key: string) => Promise<R2ObjectBody | null>
}
