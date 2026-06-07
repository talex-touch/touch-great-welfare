<script setup lang="ts">
import type { CouponDiscountType, CouponScope, ResourceType } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxInput, TxNumberInput, TxStatusBadge, TxTabItem, TxTabs } from '@talex-touch/tuffex'
import { computed, ref } from 'vue'
import { useWelfareFeedback } from '~/composables/feedback'
import { formatDate, RESOURCE_TYPE_CONFIGS } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'

const {
  state,
  isAdmin,
  couponTemplates,
  couponCodes,
  couponRedemptions,
  couponTemplateForm,
  couponCodeForm,
  couponGrantForm,
  createCouponTemplateFromForm,
  createCouponCodeFromForm,
  grantCouponFromTemplateForm,
} = useWelfareUiState()

const { runSafely, notify } = useWelfareFeedback()
const activeTab = ref('券种管理')

const scopeOptions: Array<{ value: CouponScope, label: string }> = [
  { value: 'resource', label: '资源抵扣' },
  { value: 'recharge', label: '充值抵扣' },
  { value: 'general', label: '通用优惠' },
]
const discountTypeOptions: Array<{ value: CouponDiscountType, label: string }> = [
  { value: 'rate', label: '折扣倍率' },
  { value: 'fixed_points', label: '固定积分抵扣' },
  { value: 'fixed_ldc', label: '固定 LDC 抵扣' },
]
const resourceOptions = RESOURCE_TYPE_CONFIGS.map(item => ({ value: item.resourceType, label: item.displayName }))
const templateById = computed(() => new Map(couponTemplates.value.map(template => [template.id, template])))
const grantedCouponRows = computed(() => state.coupons.slice(0, 30))

function scopeText(scope: CouponScope) {
  return scopeOptions.find(item => item.value === scope)?.label ?? scope
}

function discountText(rule: { discountType: CouponDiscountType, discountRate?: number, discountAmount?: number }) {
  if (rule.discountType === 'rate')
    return `${Number((rule.discountRate ?? 1) * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
  if (rule.discountType === 'fixed_ldc')
    return `抵扣 ${rule.discountAmount ?? 0} LDC`
  return `抵扣 ${rule.discountAmount ?? 0} 积分`
}

function sourceText(source: string) {
  if (source === 'redemption_code')
    return '兑换码'
  if (source === 'bulk_grant')
    return '统一发放'
  if (source === 'manual')
    return '管理员发放'
  return '系统奖励'
}

function userName(userId: string) {
  return state.users.find(user => user.id === userId)?.profile.displayName ?? userId
}

function toggleResourceType(resourceType: ResourceType, checked: boolean) {
  const next = new Set(couponTemplateForm.resourceTypes)
  if (checked)
    next.add(resourceType)
  else
    next.delete(resourceType)
  couponTemplateForm.resourceTypes = Array.from(next)
}

function toggleGrantUser(userId: string, checked: boolean) {
  const next = new Set(couponGrantForm.userIds)
  if (checked)
    next.add(userId)
  else
    next.delete(userId)
  couponGrantForm.userIds = Array.from(next)
}

function createTemplate() {
  runSafely(async () => {
    const template = await createCouponTemplateFromForm()
    notify(`券种已创建：${template.name}`)
  }, '券种已创建')
}

function createCode() {
  runSafely(async () => {
    const code = await createCouponCodeFromForm()
    notify(`兑换码已生成：${code.code}`)
  }, '兑换码已生成')
}

function grantCoupons() {
  runSafely(async () => {
    const coupons = await grantCouponFromTemplateForm()
    notify(`已发放 ${coupons.length} 张优惠券`)
  }, '优惠券已统一发放')
}
</script>

<template>
  <section class="space-y-5">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            优惠券中心
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            独立管理资源抵扣、充值抵扣和通用优惠，支持兑换码、自助兑换、次数限制和统一发放。
          </p>
        </div>
        <TxStatusBadge :text="`${couponTemplates.length} 个券种 / ${couponCodes.length} 个兑换码`" status="info" />
      </div>
    </TxCard>

    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="0" :radius="28">
      <TxTabs v-model="activeTab" :default-value="activeTab" placement="top" indicator-variant="block" indicator-motion="glide" :content-padding="24" borderless>
        <TxTabItem name="券种管理" icon-class="i-carbon-percentage">
          <template #name>
            券种管理
          </template>

          <div class="gap-5 grid xl:grid-cols-[420px_1fr]">
            <section class="admin-detail-section">
              <div class="admin-detail-title">
                <span class="i-carbon-add" />
                新建券种
              </div>
              <div class="mt-4 gap-4 grid">
                <label class="gap-2 grid">
                  <span class="field-label">名称</span>
                  <TxInput v-model="couponTemplateForm.name" :disabled="!isAdmin" placeholder="资源通用八折券" />
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">说明</span>
                  <TxInput v-model="couponTemplateForm.description" :disabled="!isAdmin" placeholder="可选，展示给管理员识别用途" />
                </label>
                <div class="gap-3 grid sm:grid-cols-2">
                  <label class="gap-2 grid">
                    <span class="field-label">适用范围</span>
                    <select v-model="couponTemplateForm.scope" class="form-select" :disabled="!isAdmin">
                      <option v-for="option in scopeOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">优惠类型</span>
                    <select v-model="couponTemplateForm.discountType" class="form-select" :disabled="!isAdmin">
                      <option v-for="option in discountTypeOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                </div>
                <div class="gap-3 grid sm:grid-cols-2">
                  <label v-if="couponTemplateForm.discountType === 'rate'" class="gap-2 grid">
                    <span class="field-label">折扣</span>
                    <TxNumberInput v-model="couponTemplateForm.discountFold" :min="0.1" :max="10" :step="0.1" :controls="false" :disabled="!isAdmin" />
                    <span class="field-hint">8 = 八折，5 = 五折。</span>
                  </label>
                  <label v-else class="gap-2 grid">
                    <span class="field-label">抵扣金额</span>
                    <TxNumberInput v-model="couponTemplateForm.discountAmount" :min="1" :max="100000" :step="1" :controls="false" :disabled="!isAdmin" />
                    <span class="field-hint">资源券为积分，充值券为 LDC。</span>
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">有效期（天）</span>
                    <TxNumberInput v-model="couponTemplateForm.ttlDays" :min="0" :max="3650" :step="1" :controls="false" :disabled="!isAdmin" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">最低消费</span>
                    <TxNumberInput v-model="couponTemplateForm.minSpend" :min="0" :max="100000" :step="1" :controls="false" :disabled="!isAdmin" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">最高优惠</span>
                    <TxNumberInput v-model="couponTemplateForm.maxDiscount" :min="0" :max="100000" :step="1" :controls="false" :disabled="!isAdmin" />
                  </label>
                </div>
                <div v-if="couponTemplateForm.scope !== 'recharge'" class="gap-2 grid">
                  <span class="field-label">限定资源类型</span>
                  <div class="flex flex-wrap gap-2">
                    <label v-for="option in resourceOptions" :key="option.value" class="admin-action-check">
                      <TxCheckbox :model-value="couponTemplateForm.resourceTypes.includes(option.value)" variant="checkmark" :disabled="!isAdmin" @change="value => toggleResourceType(option.value, value)" />
                      {{ option.label }}
                    </label>
                  </div>
                  <span class="field-hint">不选择表示全部资源类型通用。</span>
                </div>
                <TxButton variant="primary" :disabled="!isAdmin" @click="createTemplate">
                  创建券种
                </TxButton>
              </div>
            </section>

            <section class="admin-detail-section">
              <div class="admin-detail-title">
                <span class="i-carbon-list" />
                已有券种
              </div>
              <div class="mt-4 space-y-3">
                <div v-if="!couponTemplates.length" class="admin-empty">
                  暂无券种
                </div>
                <div v-for="template in couponTemplates" :key="template.id" class="admin-history-row">
                  <span class="admin-pill" :class="template.enabled ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30' : 'text-slate-700 bg-slate-100 dark:text-slate-200 dark:bg-white/10'">
                    {{ scopeText(template.rule.scope) }}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="fw-900 truncate">
                      {{ template.name }} · {{ discountText(template.rule) }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      已发 {{ template.grantedCount }}{{ template.totalGrantLimit ? ` / ${template.totalGrantLimit}` : '' }} · {{ template.ttlDays ? `${template.ttlDays} 天有效` : '长期有效' }}
                    </div>
                  </div>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(template.createdAt) }}</span>
                </div>
              </div>
            </section>
          </div>
        </TxTabItem>

        <TxTabItem name="兑换码" icon-class="i-carbon-ticket">
          <template #name>
            兑换码
          </template>

          <div class="gap-5 grid xl:grid-cols-[420px_1fr]">
            <section class="admin-detail-section">
              <div class="admin-detail-title">
                <span class="i-carbon-ticket" />
                生成兑换码
              </div>
              <div class="mt-4 gap-4 grid">
                <label class="gap-2 grid">
                  <span class="field-label">券种</span>
                  <select v-model="couponCodeForm.templateId" class="form-select" :disabled="!isAdmin">
                    <option value="">
                      选择券种
                    </option>
                    <option v-for="template in couponTemplates" :key="template.id" :value="template.id">
                      {{ template.name }} · {{ discountText(template.rule) }}
                    </option>
                  </select>
                </label>
                <label class="gap-2 grid">
                  <span class="field-label">兑换码</span>
                  <TxInput v-model="couponCodeForm.code" :disabled="!isAdmin" placeholder="留空自动生成" />
                </label>
                <div class="gap-3 grid sm:grid-cols-2">
                  <label class="gap-2 grid">
                    <span class="field-label">总次数</span>
                    <TxNumberInput v-model="couponCodeForm.maxRedemptions" :min="1" :max="100000" :step="1" :controls="false" :disabled="!isAdmin" />
                  </label>
                  <label class="gap-2 grid">
                    <span class="field-label">每人次数</span>
                    <TxNumberInput v-model="couponCodeForm.perUserLimit" :min="1" :max="100" :step="1" :controls="false" :disabled="!isAdmin" />
                  </label>
                </div>
                <label class="gap-2 grid">
                  <span class="field-label">兑换码过期时间</span>
                  <input v-model="couponCodeForm.expiresAt" type="datetime-local" class="admin-date-input" :disabled="!isAdmin">
                </label>
                <TxButton variant="primary" :disabled="!isAdmin || !couponCodeForm.templateId" @click="createCode">
                  生成兑换码
                </TxButton>
              </div>
            </section>

            <section class="admin-detail-section">
              <div class="admin-detail-title">
                <span class="i-carbon-data-table" />
                兑换码列表
              </div>
              <div class="mt-4 space-y-3">
                <div v-if="!couponCodes.length" class="admin-empty">
                  暂无兑换码
                </div>
                <div v-for="code in couponCodes" :key="code.id" class="admin-history-row">
                  <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">
                    {{ code.code }}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="fw-900 truncate">
                      {{ templateById.get(code.templateId)?.name || '未知券种' }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      已兑 {{ code.redeemedCount }} / {{ code.maxRedemptions }} · 每人 {{ code.perUserLimit }} 次 · {{ code.expiresAt ? `过期 ${formatDate(code.expiresAt)}` : '不过期' }}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </TxTabItem>

        <TxTabItem name="统一发放" icon-class="i-carbon-user-multiple">
          <template #name>
            统一发放
          </template>

          <div class="gap-5 grid xl:grid-cols-[420px_1fr]">
            <section class="admin-detail-section">
              <div class="admin-detail-title">
                <span class="i-carbon-send" />
                发放给用户
              </div>
              <div class="mt-4 gap-4 grid">
                <label class="gap-2 grid">
                  <span class="field-label">券种</span>
                  <select v-model="couponGrantForm.templateId" class="form-select" :disabled="!isAdmin">
                    <option value="">
                      选择券种
                    </option>
                    <option v-for="template in couponTemplates" :key="template.id" :value="template.id">
                      {{ template.name }} · {{ discountText(template.rule) }}
                    </option>
                  </select>
                </label>
                <div class="pr-1 gap-2 grid max-h-90 overflow-auto">
                  <span class="field-label">用户</span>
                  <label v-for="user in state.users" :key="user.id" class="admin-action-check justify-between">
                    <span>{{ user.profile.displayName }} · {{ user.profile.email }}</span>
                    <TxCheckbox :model-value="couponGrantForm.userIds.includes(user.id)" variant="checkmark" :disabled="!isAdmin" @change="value => toggleGrantUser(user.id, value)" />
                  </label>
                </div>
                <TxButton variant="primary" :disabled="!isAdmin || !couponGrantForm.templateId || !couponGrantForm.userIds.length" @click="grantCoupons">
                  统一发放 {{ couponGrantForm.userIds.length }} 张
                </TxButton>
              </div>
            </section>

            <section class="admin-detail-section">
              <div class="admin-detail-title">
                <span class="i-carbon-receipt" />
                最近发放 / 兑换
              </div>
              <div class="mt-4 space-y-3">
                <div v-if="!grantedCouponRows.length" class="admin-empty">
                  暂无优惠券发放记录
                </div>
                <div v-for="coupon in grantedCouponRows" :key="coupon.id" class="admin-history-row">
                  <span class="admin-pill text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-950/30">
                    {{ sourceText(coupon.source) }}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="fw-900 truncate">
                      {{ coupon.name }} · {{ userName(coupon.userId) }}
                    </div>
                    <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                      {{ coupon.expiresAt ? `有效至 ${formatDate(coupon.expiresAt)}` : '长期有效' }} · {{ coupon.usedAt ? `已使用 ${formatDate(coupon.usedAt)}` : '未使用' }}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </TxTabItem>

        <TxTabItem name="兑换记录" icon-class="i-carbon-time">
          <template #name>
            兑换记录
          </template>

          <div class="admin-detail-section">
            <div class="admin-detail-title">
              <span class="i-carbon-time" />
              用户自助兑换记录
            </div>
            <div class="mt-4 space-y-3">
              <div v-if="!couponRedemptions.length" class="admin-empty">
                暂无兑换记录
              </div>
              <div v-for="record in couponRedemptions" :key="record.id" class="admin-history-row">
                <span class="admin-pill text-sky-700 bg-sky-50 dark:text-sky-200 dark:bg-sky-950/30">
                  兑换
                </span>
                <div class="flex-1 min-w-0">
                  <div class="fw-900 truncate">
                    {{ userName(record.userId) }} · {{ templateById.get(record.templateId)?.name || record.templateId }}
                  </div>
                  <div class="text-xs text-slate-500 truncate dark:text-slate-400">
                    兑换码 {{ couponCodes.find(code => code.id === record.codeId)?.code || record.codeId }}
                  </div>
                </div>
                <span class="text-xs text-slate-500 dark:text-slate-400">{{ formatDate(record.redeemedAt) }}</span>
              </div>
            </div>
          </div>
        </TxTabItem>
      </TxTabs>
    </TxCard>
  </section>
</template>
