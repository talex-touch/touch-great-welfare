import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import App from './App.vue'
import { ensureWelfareStateLoaded, useWelfareStore } from './composables/welfare'

import '@talex-touch/tuffex/style.css'
import './styles/main.css'
import 'uno.css'

const app = createApp(App)
const router = createRouter({
  routes,
  history: createWebHistory(import.meta.env.BASE_URL),
})
const welfare = useWelfareStore()

router.beforeEach(async (to) => {
  await ensureWelfareStateLoaded().catch(() => undefined)

  if (welfare.persistenceError.value)
    return undefined

  const hasAdmin = welfare.hasAdmin.value
  const currentUser = welfare.currentUser.value
  const isAuthRoute = to.path === '/init' || to.path === '/login'
  const isDashboardRoute = to.path === '/dashboard' || to.path.startsWith('/dashboard/')

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
})

app.use(router)
app.mount('#app')
