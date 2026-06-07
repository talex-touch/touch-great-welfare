<script setup lang="ts">
import { FileUploader, TxButton, TxCard, TxCheckbox, TxInput, TxStep, TxSteps } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import {
  EDUCATION_EMAIL_REVIEW_INBOX,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  STUDENT_REVIEW_FEE,
  verificationOrganizationLabel,
  verificationTypeLabel,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'

const {
  state,
  currentUser,
  educationEmailVerificationForm,
  studentForm,
  verificationTypeOptions,
  frontlineCategoryOptions,
  studentCategoryOptions,
  studentFiles,
  studentGradeOptions,
  studentSchoolSuggestions,
  totalStudentBytes,
  systemConfig,
  submitStudentVerification,
  supplementStudentVerification,
  fillStudentFormFromVerification,
  resetStudentFiles,
  resetEducationEmailVerificationForm,
  generateEducationEmailChallenge,
  copyEducationEmailTemplate,
  openEducationEmailClient,
  confirmEducationEmailSent,
} = useWelfareUiState()

const router = useRouter()
const route = useRoute()
const { runSafely } = useWelfareFeedback()
const hasStudentConsent = ref(false)
const currentStep = ref<'notice' | 'details'>('notice')
const isCategorySuggestionsOpen = ref(false)
const isGradeSuggestionsOpen = ref(false)
const isSchoolSuggestionsOpen = ref(false)
const studentDraftKey = 'welfare:student-draft'
let categorySuggestionsCloseTimer: ReturnType<typeof setTimeout> | undefined
let gradeSuggestionsCloseTimer: ReturnType<typeof setTimeout> | undefined
let schoolSuggestionsCloseTimer: ReturnType<typeof setTimeout> | undefined

const activeStep = computed(() => currentStep.value === 'notice' ? 0 : 1)
const selectedVerificationType = computed(() => studentForm.verificationType)
const isStudentVerification = computed(() => selectedVerificationType.value === 'student')
const currentVerificationLabel = computed(() => verificationTypeLabel(selectedVerificationType.value))
const currentOrganizationLabel = computed(() => verificationOrganizationLabel(selectedVerificationType.value))
const currentCategoryOptions = computed(() => isStudentVerification.value ? [...studentCategoryOptions] : [...frontlineCategoryOptions])
const selectedVerificationOption = computed(() => verificationTypeOptions.find(option => option.value === selectedVerificationType.value) ?? verificationTypeOptions[0])
const selectedVerificationToggle = computed(() => systemConfig.value.verification[selectedVerificationType.value])
const isVerificationEntryOpen = computed(() => systemConfig.value.siteEnabled && selectedVerificationToggle.value.enabled)
const verificationClosedReason = computed(() => !systemConfig.value.siteEnabled ? systemConfig.value.siteClosedReason : selectedVerificationToggle.value.reason || `${currentVerificationLabel.value}暂未开放`)
const editingVerificationId = computed(() => {
  const raw = route.query.edit
  return Array.isArray(raw) ? raw[0] : String(raw ?? '')
})
const editingVerification = computed(() => state.studentVerifications.find(item =>
  item.id === editingVerificationId.value
  && item.userId === currentUser.value?.id
  && item.status === 'needs_supplement',
))
const isSupplementMode = computed(() => !!editingVerification.value)
const INITIAL_SCHOOL_SUGGESTION_LIMIT = 48

const filteredStudentSchoolSuggestions = computed(() => {
  const query = normalizeSchoolQuery(studentForm.school)
  const privacyOption = studentSchoolSuggestions.find(school => school.name === '保密')
  const regularSuggestions = studentSchoolSuggestions.filter(school => school.name !== '保密')
  const matchedSuggestions = query
    ? regularSuggestions.filter(school => school.searchText.includes(query))
    : regularSuggestions.slice(0, INITIAL_SCHOOL_SUGGESTION_LIMIT)

  return [
    ...(privacyOption ? [privacyOption] : []),
    ...matchedSuggestions,
  ]
})

const filteredStudentGradeOptions = computed(() => isStudentVerification.value ? [...studentGradeOptions] : ['3 个月内', '半年内', '1 年', '2 年', '3 年及以上', '长期服务'])

function continueToDetails() {
  if (!isVerificationEntryOpen.value)
    return

  currentStep.value = 'details'
}

function backToNotice() {
  currentStep.value = 'notice'
}

function cancelCreate() {
  router.push('/dashboard/verification')
}

function openCategorySuggestions() {
  if (categorySuggestionsCloseTimer)
    clearTimeout(categorySuggestionsCloseTimer)

  isCategorySuggestionsOpen.value = true
}

function openGradeSuggestions() {
  if (gradeSuggestionsCloseTimer)
    clearTimeout(gradeSuggestionsCloseTimer)

  isGradeSuggestionsOpen.value = true
}

function openSchoolSuggestions() {
  if (schoolSuggestionsCloseTimer)
    clearTimeout(schoolSuggestionsCloseTimer)

  isSchoolSuggestionsOpen.value = true
}

function closeCategorySuggestionsSoon() {
  categorySuggestionsCloseTimer = setTimeout(() => {
    isCategorySuggestionsOpen.value = false
  }, 120)
}

function closeGradeSuggestionsSoon() {
  gradeSuggestionsCloseTimer = setTimeout(() => {
    isGradeSuggestionsOpen.value = false
  }, 120)
}

function closeSchoolSuggestionsSoon() {
  schoolSuggestionsCloseTimer = setTimeout(() => {
    isSchoolSuggestionsOpen.value = false
  }, 120)
}

function selectStudentCategory(category: string) {
  studentForm.category = category
  isCategorySuggestionsOpen.value = false
}

function selectStudentGrade(grade: string) {
  studentForm.grade = grade
  isGradeSuggestionsOpen.value = false
}

function selectStudentSchool(school: string) {
  studentForm.school = school
  isSchoolSuggestionsOpen.value = false
}

function normalizeSchoolQuery(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s/\\:_\-()（）【】[\]{}.,，。·]+/g, '')
}

function onSubmitStudentVerification() {
  runSafely(async () => {
    if (!isSupplementMode.value && !isVerificationEntryOpen.value)
      throw new Error(verificationClosedReason.value)

    const payload = {
      realName: studentForm.realName,
      verificationType: studentForm.verificationType,
      category: studentForm.category,
      school: studentForm.school,
      identity: studentForm.identity,
      grade: studentForm.grade,
      educationEmail: studentForm.educationEmail,
      educationEmailChallengeId: educationEmailVerificationForm.challengeId,
      educationEmailVerified: educationEmailVerificationForm.verified,
      notes: studentForm.notes,
      attachments: studentFiles.value,
    }
    if (isSupplementMode.value) {
      await supplementStudentVerification({
        ...payload,
        verificationId: editingVerification.value!.id,
      })
    }
    else {
      await submitStudentVerification(payload)
    }
    resetStudentFiles()
    clearLocalDraft(studentDraftKey)
    router.push('/dashboard/verification')
  }, isSupplementMode.value ? `${currentVerificationLabel.value}补充资料已提交，等待管理员继续审核` : `${currentVerificationLabel.value}已提交并扣除 ${STUDENT_REVIEW_FEE} 积分审核费`)
}

function onGenerateEducationEmailChallenge() {
  runSafely(async () => {
    await generateEducationEmailChallenge()
  }, '教育邮箱证明码已生成')
}

function onCopyEducationEmailTemplate() {
  runSafely(async () => {
    await copyEducationEmailTemplate()
  }, '邮件模板已复制')
}

function onOpenEducationEmailClient() {
  runSafely(async () => {
    await openEducationEmailClient()
  }, '已打开邮件客户端')
}

function onConfirmEducationEmailSent() {
  runSafely(async () => {
    await confirmEducationEmailSent()
  }, '已验证教育邮箱真实性')
}

function resetEducationEmailProof() {
  studentForm.educationEmail = ''
  resetEducationEmailVerificationForm()
}

onMounted(() => {
  if (editingVerification.value) {
    fillStudentFormFromVerification(editingVerification.value)
    currentStep.value = 'details'
    hasStudentConsent.value = true
  }
  else {
    restoreLocalDraft(studentDraftKey, studentForm)
    studentForm.verificationType = route.query.type === 'frontline' ? 'frontline' : 'student'
  }
  if (studentForm.verificationType === 'frontline')
    resetEducationEmailProof()
  if (!editingVerification.value)
    persistLocalDraft(studentDraftKey, studentForm)
})
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="resource-create-header">
        <button class="resource-back-button" type="button" title="返回列表" @click="cancelCreate">
          <span class="i-carbon-chevron-left" />
        </button>
        <div class="min-w-0">
          <h2 class="resource-create-title">
            {{ isSupplementMode ? '补充认证资料' : '提交认证申请' }}
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            {{ isSupplementMode ? '根据审核意见更新资料，重新提交后会回到待审核队列，不重复扣除审核费。' : '先选择认证子类并确认材料处理边界，再填写认证信息。草稿会保存在本地浏览器。' }}
          </p>
        </div>
      </div>

      <TxSteps :active="activeStep" class="mt-6" size="small">
        <TxStep title="确认说明" description="自愿提交 / 7 天保留" />
        <TxStep title="填写认证" description="所见即所得编辑" />
        <TxStep title="审核流转" description="扣费 / 审核 / 返还" />
      </TxSteps>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可以申请认证。
      </div>
      <div v-else-if="!isSupplementMode && !isVerificationEntryOpen" class="mt-6 p-8 text-center border border-amber-300 rounded-3xl bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
        {{ verificationClosedReason }}
      </div>

      <div v-else class="mt-6 space-y-6">
        <template v-if="currentStep === 'notice'">
          <DataNotice mode="full" title="认证申请与材料免责确认" timing="before" />
          <label class="consent-check">
            <TxCheckbox v-model="hasStudentConsent" variant="checkmark" aria-label="同意认证申请与材料免责确认" />
            <span>我确认认证资料由我自愿提供，已按需脱敏；继续填写即表示同意提交成功后生成云端记录、审核费规则、管理员审核处理和上述免责说明。</span>
          </label>
          <div class="flex justify-end">
            <TxButton variant="primary" :disabled="!hasStudentConsent || !isVerificationEntryOpen" @click="continueToDetails">
              继续填写
            </TxButton>
          </div>
        </template>

        <template v-else>
          <div class="flex flex-wrap gap-3 items-center justify-between">
            <div>
              <div class="text-xs text-slate-500 dark:text-slate-400">
                当前规则
              </div>
              <div class="text-xl fw-900">
                {{ isSupplementMode ? `${currentVerificationLabel} · 补充资料 · 不重复扣费` : `${currentVerificationLabel} · 审核费 ${STUDENT_REVIEW_FEE} 积分 · 通过后返还` }}
              </div>
            </div>
            <div class="flex flex-wrap gap-3 items-center">
              <span class="text-xs text-emerald-700 fw-800 dark:text-emerald-300">
                草稿已本地保存
              </span>
              <TxButton variant="ghost" @click="backToNotice">
                查看说明
              </TxButton>
            </div>
          </div>

          <DataNotice mode="compact" title="填写前提示" timing="before" />

          <div class="verification-type-lock">
            <div class="verification-type-lock__main">
              <span class="verification-type-lock__icon i-carbon-locked" />
              <div>
                <div class="verification-type-lock__eyebrow">
                  {{ isSupplementMode ? '正在补充资料' : '认证子类已锁定' }}
                </div>
                <div class="verification-type-lock__title">
                  {{ selectedVerificationOption.label }}
                </div>
                <p class="verification-type-lock__description">
                  {{ selectedVerificationOption.description }}
                </p>
              </div>
            </div>
            <TxButton variant="ghost" @click="cancelCreate">
              {{ isSupplementMode ? '返回认证' : '重新选择' }}
            </TxButton>
          </div>

          <div v-if="isSupplementMode && editingVerification?.reply" class="verification-submit-warning">
            <b>审核补充要求：</b>
            <RichTextView :content="editingVerification.reply" class="rich-text-preview mt-2" />
          </div>

          <div class="gap-5 grid md:grid-cols-2">
            <label class="verification-form-field gap-2 grid">
              <span class="field-label">真实姓名</span>
              <TxInput v-model="studentForm.realName" placeholder="必须填写，用于人工复核" />
              <span class="field-hint">认证申请强制提供姓名；请勿填写昵称或无法复核的称呼。</span>
            </label>
            <div class="verification-form-field gap-2 grid">
              <span class="field-label">认证类目</span>
              <div class="school-combobox">
                <TxInput
                  v-model="studentForm.category"
                  readonly
                  placeholder="请选择认证类目"
                  @focus="openCategorySuggestions"
                  @click="openCategorySuggestions"
                  @blur="closeCategorySuggestionsSoon"
                >
                  <template #suffix>
                    <span class="i-carbon-chevron-down text-slate-500" />
                  </template>
                </TxInput>
                <div v-if="isCategorySuggestionsOpen" class="school-suggestions-panel">
                  <button
                    v-for="category in currentCategoryOptions"
                    :key="category"
                    type="button"
                    class="school-suggestion-option"
                    :class="{ 'is-active': category === studentForm.category }"
                    @mousedown.prevent="selectStudentCategory(category)"
                  >
                    {{ category }}
                  </button>
                </div>
              </div>
            </div>
            <div class="verification-form-field gap-2 grid">
              <span class="field-label">{{ currentOrganizationLabel }}</span>
              <div class="school-combobox">
                <TxInput
                  v-model="studentForm.school"
                  :placeholder="isStudentVerification ? '输入学校名称，或选择保密 / 内置学校' : '填写服务组织、单位或项目名称'"
                  @focus="openSchoolSuggestions"
                  @input="openSchoolSuggestions"
                  @blur="closeSchoolSuggestionsSoon"
                >
                  <template #suffix>
                    <span class="i-carbon-chevron-down text-slate-500" />
                  </template>
                </TxInput>
                <div v-if="isStudentVerification && isSchoolSuggestionsOpen && filteredStudentSchoolSuggestions.length" class="school-suggestions-panel">
                  <button
                    v-for="school in filteredStudentSchoolSuggestions"
                    :key="school.name"
                    type="button"
                    class="school-suggestion-option"
                    :class="{ 'is-active': school.name === studentForm.school }"
                    @mousedown.prevent="selectStudentSchool(school.name)"
                  >
                    <span>{{ school.name }}</span>
                    <span v-if="school.province || school.city" class="school-suggestion-meta">
                      {{ [school.province, school.city].filter(Boolean).join(' · ') }}
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <div class="gap-5 grid md:col-span-2 md:grid-cols-2">
              <div class="verification-form-field gap-2 grid">
                <span class="field-label">年级</span>
                <div class="school-combobox">
                  <TxInput
                    v-model="studentForm.grade"
                    :placeholder="isStudentVerification ? '可选择年级，也可自行输入' : '填写服务周期，也可自行输入'"
                    @focus="openGradeSuggestions"
                    @input="openGradeSuggestions"
                    @blur="closeGradeSuggestionsSoon"
                  >
                    <template #suffix>
                      <span class="i-carbon-chevron-down text-slate-500" />
                    </template>
                  </TxInput>
                  <div v-if="isGradeSuggestionsOpen && filteredStudentGradeOptions.length" class="school-suggestions-panel">
                    <button
                      v-for="grade in filteredStudentGradeOptions"
                      :key="grade"
                      type="button"
                      class="school-suggestion-option"
                      :class="{ 'is-active': grade === studentForm.grade }"
                      @mousedown.prevent="selectStudentGrade(grade)"
                    >
                      {{ grade }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="isStudentVerification" class="gap-2 grid md:col-span-2">
              <label class="gap-2 grid">
                <span class="field-label">教育邮箱邮件证明</span>
                <TxInput v-model="studentForm.educationEmail" type="email" placeholder="name@school.edu.cn，可选" />
              </label>
              <div class="gap-3 grid xl:grid-cols-[1fr_auto_auto_auto_auto]">
                <TxInput v-model="educationEmailVerificationForm.code" readonly placeholder="生成后显示唯一证明码" />
                <TxButton variant="secondary" :disabled="educationEmailVerificationForm.loading || !studentForm.educationEmail" @click="onGenerateEducationEmailChallenge">
                  {{ educationEmailVerificationForm.loading ? '生成中' : '生成证明码' }}
                </TxButton>
                <TxButton variant="secondary" :disabled="!studentForm.educationEmail" @click="onCopyEducationEmailTemplate">
                  复制模板
                </TxButton>
                <TxButton variant="primary" :disabled="!studentForm.educationEmail" @click="onOpenEducationEmailClient">
                  一键发邮件
                </TxButton>
                <TxButton variant="secondary" :disabled="!educationEmailVerificationForm.challengeId || educationEmailVerificationForm.verified" @click="onConfirmEducationEmailSent">
                  {{ educationEmailVerificationForm.verified ? '已验证真实性' : '我已发送验证码' }}
                </TxButton>
              </div>
              <p class="field-hint">
                需要使用该教育邮箱向 {{ EDUCATION_EMAIL_REVIEW_INBOX }} 发送包含唯一证明码的邮件；该邮件只作为辅助证明，管理员仍会人工复核材料。
              </p>
              <p v-if="educationEmailVerificationForm.subject" class="field-hint">
                邮件主题：{{ educationEmailVerificationForm.subject }}
              </p>
              <p v-if="educationEmailVerificationForm.message" class="field-hint text-emerald-700 dark:text-emerald-300">
                {{ educationEmailVerificationForm.message }}
              </p>
            </div>
            <div class="gap-2 grid md:col-span-2">
              <div class="flex flex-wrap gap-2 items-center justify-between">
                <span class="field-label">材料说明</span>
                <span class="field-hint">所见即所得 · 草稿已本地保存</span>
              </div>
              <RichTextEditor
                v-model="studentForm.notes"
                :min-height="260"
                placeholder="请说明身份背景、材料清单和需要管理员注意的补充信息。建议脱敏填写，不要提交身份证件原图、密码、密钥或涉密科研材料。"
              />
            </div>
            <div class="md:col-span-2">
              <div class="mb-2 flex gap-3 items-center justify-between">
                <span class="field-label">证明材料</span>
                <span class="field-hint">{{ formatBytes(totalStudentBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
              </div>
              <FileUploader v-model="studentFiles" :max="12" button-text="上传材料" drop-text="拖拽证明材料" hint-text="支持任意材料，总大小 200MB 内" />
              <p class="field-hint mt-2">
                {{ isSupplementMode ? `原记录已保留 ${editingVerification?.attachments.length ?? 0} 个材料；本次上传会追加保存。建议遮挡证件号、人脸、家庭住址、二维码等非必要信息。` : '证明材料会在认证提交成功后随记录保存；建议遮挡证件号、人脸、家庭住址、二维码等非必要信息。' }}
              </p>
            </div>
          </div>

          <div class="verification-submit-warning md:col-span-2">
            {{ isSupplementMode ? '补充提交不会再次扣除审核费；管理员会基于原材料和本次补充继续审核。' : `提交后会立即扣除 ${STUDENT_REVIEW_FEE} 积分作为审核费；如果审核通过，系统自动返还这 ${STUDENT_REVIEW_FEE} 积分。确认提交即视为同意本次规则和数据处理说明。` }}
          </div>

          <div class="flex gap-3 justify-end">
            <TxButton variant="ghost" @click="cancelCreate">
              取消
            </TxButton>
            <TxButton variant="primary" @click="onSubmitStudentVerification">
              {{ isSupplementMode ? '提交补充资料' : '提交认证' }}
            </TxButton>
          </div>
        </template>
      </div>
    </TxCard>
  </section>
</template>
