import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import App from './App.vue'
import { useWelfareFeedback } from './composables/feedback'
import { ensureWelfareStateLoaded, normalizeSystemConfig, useWelfareStore } from './composables/welfare'

import '@talex-touch/tuffex/style.css'
import './styles/main.css'
import 'uno.css'

const app = createApp(App)
const router = createRouter({
  routes,
  history: createWebHistory(import.meta.env.BASE_URL),
})
const welfare = useWelfareStore()
const { installUnauthorizedFetchPrompt } = useWelfareFeedback()

installUnauthorizedFetchPrompt()

router.beforeEach(async (to) => {
  await ensureWelfareStateLoaded().catch(() => undefined)

  if (welfare.persistenceError.value)
    return undefined

  const isAuthRoute = to.path === '/init' || to.path === '/login'
  const isDashboardRoute = to.path === '/dashboard' || to.path.startsWith('/dashboard/')
  let hasAdmin = welfare.hasAdmin.value
  let currentUser = welfare.currentUser.value
  let systemConfig = normalizeSystemConfig(welfare.state.systemConfig)

  if (!isAuthRoute && currentUser && !welfare.isFullStateLoaded.value) {
    await welfare.reloadWelfareState().catch(() => undefined)
    if (welfare.persistenceError.value)
      return undefined

    hasAdmin = welfare.hasAdmin.value
    currentUser = welfare.currentUser.value
    systemConfig = normalizeSystemConfig(welfare.state.systemConfig)
  }

  // `/init` is only for first-run bootstrap. Once an admin exists, use login/dashboard instead.
  if (to.path === '/init' && hasAdmin) {
    return {
      path: currentUser ? '/dashboard/admin' : '/login',
      replace: true,
    }
  }

  // If no admin exists yet, send every normal page to the bootstrap screen.
  if (to.path !== '/init' && !hasAdmin) {
    return {
      path: '/init',
      replace: true,
    }
  }

  // When the site is closed, keep only login/admin recovery available.
  if (!systemConfig.siteEnabled && currentUser?.role !== 'admin' && to.path !== '/login') {
    return {
      path: '/login',
      replace: true,
    }
  }

  // Logged-in users do not need to see auth/bootstrap entry pages again.
  if (isAuthRoute && currentUser) {
    return {
      path: currentUser.role === 'admin' ? '/dashboard/admin' : '/dashboard/apply',
      replace: true,
    }
  }

  if (isDashboardRoute && !currentUser) {
    return {
      path: '/login',
      query: {
        redirect: to.fullPath,
      },
    }
  }

  if ((to.path === '/dashboard/admin' || to.path === '/dashboard/coupons') && currentUser?.role !== 'admin') {
    return {
      path: '/dashboard/apply',
      replace: true,
    }
  }
})

app.use(router)
app.mount('#app')
