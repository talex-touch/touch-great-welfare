import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import App from './App.vue'
import { ensureWelfareStateLoaded, useWelfareDemo } from './composables/welfare'

import '@talex-touch/tuffex/style.css'
import './styles/main.css'
import 'uno.css'

const app = createApp(App)
const router = createRouter({
  routes,
  history: createWebHistory(import.meta.env.BASE_URL),
})
const welfare = useWelfareDemo()

router.beforeEach(async (to) => {
  await ensureWelfareStateLoaded().catch(() => undefined)

  const isDashboardRoute = to.path === '/dashboard' || to.path.startsWith('/dashboard/')
  if (isDashboardRoute && !welfare.persistenceError.value && !welfare.currentUser.value) {
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
