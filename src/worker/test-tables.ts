// 测试端点 - 直接调用 hybrid-read
import type { WorkerEnv } from './welfare-state'
import { readWelfareStateFromTables } from './welfare/hybrid-read'

export async function handleTestNewTables(env: WorkerEnv) {
  try {
    const state = await readWelfareStateFromTables(env)

    return new Response(JSON.stringify({
      success: true,
      stats: {
        users: state.users?.length || 0,
        applications: state.applications?.length || 0,
        studentVerifications: state.studentVerifications?.length || 0,
        pointTransactions: state.pointTransactions?.length || 0,
      },
      sampleUser: state.users?.[0] || null,
      sampleApplication: state.applications?.[0] || null,
    }, null, 2), {
      headers: { 'content-type': 'application/json' },
    })
  }
  catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
