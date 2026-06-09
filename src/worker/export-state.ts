// 临时端点：导出解密后的 state 数据
// 访问 /admin/export-state 获取解密后的数据

import type { WorkerEnv } from '../composables/welfare'
import { readWelfareState } from './welfare/core'

export async function handleExportState(env: WorkerEnv) {
  try {
    // 读取并解密 state
    const state = await readWelfareState(env)

    // 返回解密后的数据
    return new Response(JSON.stringify({
      success: true,
      data: {
        usersCount: state.users?.length || 0,
        applicationsCount: state.applications?.length || 0,
        pointTransactionsCount: state.pointTransactions?.length || 0,
        studentVerificationsCount: state.studentVerifications?.length || 0,
        // 只导出前几条数据用于验证
        sampleUsers: state.users?.slice(0, 2) || [],
        sampleApplications: state.applications?.slice(0, 2) || [],
      },
      timestamp: new Date().toISOString(),
    }, null, 2), {
      headers: { 'content-type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: String(error),
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    })
  }
}
