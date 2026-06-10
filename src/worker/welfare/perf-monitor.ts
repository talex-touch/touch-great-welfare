/**
 * 性能监控工具
 * 用于追踪和记录关键操作的耗时
 */

interface PerfEntry {
  operation: string
  startTime: number
  duration?: number
  metadata?: Record<string, unknown>
}

const perfStack: PerfEntry[] = []

/**
 * 开始性能追踪
 */
export function perfStart(operation: string, metadata?: Record<string, unknown>) {
  perfStack.push({
    operation,
    startTime: Date.now(),
    metadata,
  })
}

/**
 * 结束性能追踪并记录
 */
export function perfEnd(operation: string) {
  const entry = perfStack.findLast(e => e.operation === operation && !e.duration)
  if (!entry)
    return

  entry.duration = Date.now() - entry.startTime

  // 记录慢操作（超过 1 秒）
  if (entry.duration > 1000) {
    console.warn(`[PERF SLOW] ${operation}: ${entry.duration}ms`, entry.metadata || {})
  }
  else if (entry.duration > 500) {
    console.warn(`[PERF WARN] ${operation}: ${entry.duration}ms`)
  }
  else {
    console.warn(`[PERF] ${operation}: ${entry.duration}ms`)
  }
}

/**
 * 包装异步函数，自动追踪性能
 */
export async function perfWrap<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  perfStart(operation, metadata)
  try {
    return await fn()
  }
  finally {
    perfEnd(operation)
  }
}

/**
 * 包装同步函数，自动追踪性能
 */
export function perfWrapSync<T>(
  operation: string,
  fn: () => T,
  metadata?: Record<string, unknown>,
): T {
  perfStart(operation, metadata)
  try {
    return fn()
  }
  finally {
    perfEnd(operation)
  }
}

/**
 * 获取性能统计摘要
 */
export function getPerfSummary() {
  const completed = perfStack.filter(e => e.duration !== undefined)
  const total = completed.reduce((sum, e) => sum + (e.duration || 0), 0)

  return {
    totalOperations: completed.length,
    totalDuration: total,
    slowOperations: completed.filter(e => (e.duration || 0) > 1000).length,
    operations: completed.map(e => ({
      operation: e.operation,
      duration: e.duration!,
      metadata: e.metadata,
    })),
  }
}

/**
 * 清理性能追踪栈
 */
export function clearPerfStack() {
  perfStack.length = 0
}
