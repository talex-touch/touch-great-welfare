<script setup lang="ts">
import NumberFlow from '@number-flow/vue'
import { TxButton, TxCard, TxStatusBadge, TxTag } from '@talex-touch/tuffex'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareStore } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const welfare = useWelfareStore()
const router = useRouter()

const {
  currentUserLevelCard,
  pendingCount,
} = useWelfareUiState()

const handledApplications = computed(() => welfare.state.applications
  .filter(item => ['answered', 'completed', 'approved', 'partial_approved', 'closed'].includes(item.status))
  .length)
const currentLevel = computed(() => currentUserLevelCard.value)

function goApply() {
  router.push('/dashboard/apply')
}

function goSquare() {
  router.push('/dashboard/square')
}

function goProfile() {
  router.push('/dashboard/profile')
}
</script>

<template>
  <section class="home-overview">
    <TxCard class="solid-panel home-overview-panel" background="pure" shadow="soft" :padding="0" :radius="28">
      <div class="home-overview-bar">
        <TxStatusBadge text="首页工作台" status="info" />
        <TxTag
          v-if="currentLevel"
          :label="currentLevel.name"
          color="#0f766e"
          background="rgba(45,212,191,.16)"
        />
        <TxTag
          v-if="pendingCount"
          :label="`待处理 ${pendingCount}`"
          color="#b45309"
          background="rgba(245,158,11,.18)"
        />
      </div>

      <div class="home-overview-main">
        <h1>
          已处理
          <NumberFlow :value="handledApplications" :format="{ useGrouping: true }" />
          请求
        </h1>

        <div class="home-overview-actions">
          <TxButton variant="primary" @click="goApply">
            <span class="i-carbon-document-attachment" />
            申请
          </TxButton>
          <TxButton variant="secondary" @click="goSquare">
            <span class="i-carbon-campsite" />
            广场
          </TxButton>
          <TxButton variant="ghost" @click="goProfile">
            <span class="i-carbon-user-avatar" />
            个人
          </TxButton>
        </div>
      </div>
    </TxCard>
  </section>
</template>

<style scoped>
.home-overview {
  min-height: min(64vh, 36rem);
  display: flex;
}

.home-overview-panel {
  width: 100%;
  overflow: hidden;
}

.home-overview-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem 1.75rem 0;
}

.home-overview-main {
  min-height: 24rem;
  display: grid;
  align-content: center;
  gap: 2rem;
  padding: 2rem 1.75rem 3rem;
}

.home-overview-main h1 {
  margin: 0;
  max-width: 11ch;
  font-size: clamp(3.5rem, 11vw, 8.5rem);
  font-weight: 900;
  line-height: 0.96;
  letter-spacing: 0;
}

.home-overview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .home-overview {
    min-height: 58vh;
  }

  .home-overview-main {
    min-height: 20rem;
  }

  .home-overview-main h1 {
    max-width: 9ch;
    font-size: clamp(3rem, 18vw, 5.5rem);
  }
}
</style>
