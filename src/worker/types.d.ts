interface D1PreparedStatement {
  bind: (...values: unknown[]) => D1PreparedStatement
  first: <T = unknown>() => Promise<T | null>
  run: () => Promise<unknown>
}

interface D1Database {
  exec: (query: string) => Promise<unknown>
  prepare: (query: string) => D1PreparedStatement
}
