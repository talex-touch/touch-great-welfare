<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { computed } from 'vue'
import { useWelfareStore } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const welfare = useWelfareStore()
const { currentUser } = useWelfareUiState()

const handledApplications = computed(() => welfare.state.applications
  .filter(item => ['answered', 'completed', 'approved', 'partial_approved', 'closed'].includes(item.status))
  .length)
const primaryActionPath = computed(() => currentUser.value ? '/dashboard/apply/create' : '/login')
</script>

<template>
  <section class="home-overview">
    <div class="home-overview-content">
      <img src="/brand/lockup.svg" alt="领益 Link Welfare" class="home-overview-logo">

      <h1>让公益资源申请更简单</h1>

      <p class="home-overview-text">
        统一提交、审核与积分流转，适合学习、开源和公益项目的小额资源支持。
      </p>

      <div class="home-overview-status" aria-label="平台状态">
        <span>
          已处理
          <NumberFlow :value="handledApplications" :format="{ useGrouping: true }" />
          请求
        </span>
        <span>人工复核</span>
        <span>积分预扣</span>
      </div>

      <div class="home-overview-actions">
        <RouterLink class="home-overview-action home-overview-action--primary" :to="primaryActionPath">
          <span class="i-carbon-document-attachment" />
          开始申请
        </RouterLink>
        <RouterLink class="home-overview-action" to="/dashboard/square">
          <span class="i-carbon-campsite" />
          查看广场
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-overview {
  min-height: calc(100svh - 10rem);
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem 1rem 5rem;
  text-align: center;
}

.home-overview-content {
  display: grid;
  justify-items: center;
  gap: 1.4rem;
  width: min(100%, 72rem);
}

.home-overview-logo {
  width: min(15rem, 72vw);
  height: auto;
}

.home-overview h1 {
  margin: 0;
  color: #020617;
  font-size: clamp(2.4rem, 6vw, 5.4rem);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1.02;
  white-space: nowrap;
}

.home-overview-text {
  margin: 0;
  color: #020617;
  font-size: clamp(14px, 1.4vw, 18px);
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1.7;
  white-space: nowrap;
}

.home-overview-status {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.85rem 1.25rem;
  color: #475569;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.5;
}

.home-overview-status span {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.home-overview-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.8rem;
  margin-top: 0.4rem;
}

.home-overview-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  padding: 0 1.15rem;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 999px;
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.home-overview-action:hover {
  background: rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.home-overview-action--primary {
  border-color: #0f172a;
  color: #fff;
  background: #0f172a;
}

.home-overview-action--primary:hover {
  color: #fff;
  background: #1e293b;
}

.dark .home-overview h1,
.dark .home-overview-text {
  color: #f8fafc;
}

.dark .home-overview-status {
  color: #cbd5e1;
}

.dark .home-overview-action {
  border-color: rgba(255, 255, 255, 0.18);
  color: #f8fafc;
}

.dark .home-overview-action:hover {
  background: rgba(255, 255, 255, 0.08);
}

.dark .home-overview-action--primary {
  border-color: #fff;
  color: #0f172a;
  background: #fff;
}

.dark .home-overview-action--primary:hover {
  color: #0f172a;
  background: #e2e8f0;
}

@media (max-width: 640px) {
  .home-overview {
    min-height: calc(100svh - 8.5rem);
    padding: 3rem 0.75rem 4rem;
  }

  .home-overview-content {
    gap: 1.1rem;
  }

  .home-overview h1 {
    font-size: clamp(1.85rem, 8.5vw, 2.4rem);
  }

  .home-overview-text {
    font-size: clamp(12px, 3.6vw, 14px);
  }

  .home-overview-status {
    gap: 0.55rem 1rem;
  }
}
</style>
