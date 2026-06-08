<script setup lang="ts">
import { FileUploader, TxButton, TxCheckbox, TxInput } from '@talex-touch/tuffex'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import {
  analyzeEducationEmail,
  EDUCATION_EMAIL_REVIEW_INBOX,
  educationEmailReasonText,
  educationEmailUserLabel,
  formatBytes,
  formatDate,
  MAX_ATTACHMENT_BYTES,
  STUDENT_REVIEW_FEE,
  verificationOrganizationLabel,
  verificationTypeLabel,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import RichTextView from './RichTextView.vue'
import VerificationAttachmentGrid from './VerificationAttachmentGrid.vue'

const {
  state,
  currentUser,
  educationEmailVerificationForm,
  studentForm,
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
  copyEducationEmailTemplate,
  confirmEducationEmailSent,
  reloadWelfareState,
} = useWelfareUiState()

const router = useRouter()
const route = useRoute()
const { notify, runSafely } = useWelfareFeedback()
const hasStudentConsent = ref(false)
const hasReadStudentLetter = ref(false)
const isStudentLetterOpen = ref(false)
const hasStudentLetterScrolled = ref(false)
const studentLetterRemainingSeconds = ref(5)
const currentStep = ref<'notice' | 'details'>('notice')
const isCategorySuggestionsOpen = ref(false)
const isGradeSuggestionsOpen = ref(false)
const isSchoolSuggestionsOpen = ref(false)
const studentDraftKey = 'welfare:student-draft'
const studentRequestDraftKey = 'welfare:student-request-id'
let categorySuggestionsCloseTimer: ReturnType<typeof setTimeout> | undefined
let gradeSuggestionsCloseTimer: ReturnType<typeof setTimeout> | undefined
let schoolSuggestionsCloseTimer: ReturnType<typeof setTimeout> | undefined
let studentLetterTimer: ReturnType<typeof setInterval> | undefined

const selectedVerificationType = computed(() => studentForm.verificationType)
const isStudentVerification = computed(() => selectedVerificationType.value === 'student')
const currentVerificationLabel = computed(() => verificationTypeLabel(selectedVerificationType.value))
const currentOrganizationLabel = computed(() => verificationOrganizationLabel(selectedVerificationType.value))
const currentCategoryOptions = computed(() => isStudentVerification.value ? [...studentCategoryOptions] : [...frontlineCategoryOptions])
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
const educationEmailProfile = computed(() => studentForm.educationEmail.trim() ? analyzeEducationEmail(studentForm.educationEmail) : undefined)
const educationEmailProfileHint = computed(() => educationEmailProfile.value
  ? `${educationEmailUserLabel(educationEmailProfile.value, educationEmailVerificationForm.verified)} · ${educationEmailReasonText(educationEmailProfile.value)}`
  : '')
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
const canConfirmStudentLetter = computed(() => hasStudentLetterScrolled.value && studentLetterRemainingSeconds.value <= 0)
const verificationFlowSteps = computed(() => [
  {
    key: 'notice',
    title: '确认说明',
    description: currentStep.value === 'notice' ? '阅读并确认材料规则' : '已完成',
    status: currentStep.value === 'notice' ? 'current' : 'done',
  },
  {
    key: 'details',
    title: '填写认证',
    description: currentStep.value === 'details' ? '正在填写' : '待填写',
    status: currentStep.value === 'details' ? 'current' : 'pending',
  },
  {
    key: 'review',
    title: '审核流转',
    description: '提交后进入待审核',
    status: 'pending',
  },
])

function continueToDetails() {
  if (!hasStudentConsent.value)
    return

  if (!isSupplementMode.value && !isVerificationEntryOpen.value)
    return

  if (isStudentVerification.value && !hasReadStudentLetter.value) {
    openStudentLetter()
    return
  }

  currentStep.value = 'details'
}

function backToNotice() {
  currentStep.value = 'notice'
}

function openStudentLetter() {
  hasStudentLetterScrolled.value = false
  studentLetterRemainingSeconds.value = 5
  isStudentLetterOpen.value = true
  startStudentLetterTimer()
}

function startStudentLetterTimer() {
  if (studentLetterTimer)
    clearInterval(studentLetterTimer)

  studentLetterTimer = setInterval(() => {
    if (studentLetterRemainingSeconds.value <= 0) {
      if (studentLetterTimer) {
        clearInterval(studentLetterTimer)
        studentLetterTimer = undefined
      }
      return
    }

    studentLetterRemainingSeconds.value -= 1
  }, 1000)
}

function onStudentLetterScroll(event: Event) {
  const target = event.currentTarget as HTMLElement
  hasStudentLetterScrolled.value = target.scrollTop + target.clientHeight >= target.scrollHeight - 8
}

function confirmStudentLetter() {
  if (!canConfirmStudentLetter.value)
    return

  hasReadStudentLetter.value = true
  isStudentLetterOpen.value = false
  if (studentLetterTimer) {
    clearInterval(studentLetterTimer)
    studentLetterTimer = undefined
  }
  currentStep.value = 'details'
}

function goVerificationFlowStep(stepKey: string) {
  if (stepKey === 'notice') {
    backToNotice()
    return
  }

  if (stepKey === 'details')
    continueToDetails()
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

function createStudentRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `stu_req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function currentStudentRequestId() {
  if (typeof window === 'undefined')
    return createStudentRequestId()

  const existing = window.localStorage.getItem(studentRequestDraftKey)?.trim()
  if (existing)
    return existing

  const next = createStudentRequestId()
  window.localStorage.setItem(studentRequestDraftKey, next)
  return next
}

function clearStudentRequestId() {
  if (typeof window !== 'undefined')
    window.localStorage.removeItem(studentRequestDraftKey)
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
      await submitStudentVerification({
        ...payload,
        clientRequestId: currentStudentRequestId(),
      })
    }
    resetStudentFiles()
    clearLocalDraft(studentDraftKey)
    clearStudentRequestId()
    router.push('/dashboard/verification')
  }, isSupplementMode.value ? `${currentVerificationLabel.value}补充资料已提交，等待管理员继续审核` : `${currentVerificationLabel.value}已提交并扣除 ${STUDENT_REVIEW_FEE} 积分审核费`)
}

function onCopyEducationEmailTemplate() {
  runSafely(async () => {
    await copyEducationEmailTemplate()
  }, '邮件模板已复制')
}

function onConfirmEducationEmailSent() {
  runSafely(async () => {
    await confirmEducationEmailSent()
  }, '已通过收件 API 验证教育邮箱真实性')
}

function resetEducationEmailProof() {
  studentForm.educationEmail = ''
  resetEducationEmailVerificationForm()
}

async function initializeStudentForm() {
  try {
    await reloadWelfareState()
  }
  catch (error) {
    notify(error instanceof Error ? error.message : '认证状态刷新失败')
  }

  if (editingVerification.value) {
    fillStudentFormFromVerification(editingVerification.value)
    studentForm.notes = ''
    currentStep.value = 'details'
    hasStudentConsent.value = true
    hasReadStudentLetter.value = true
  }
  else {
    restoreLocalDraft(studentDraftKey, studentForm)
    studentForm.verificationType = route.query.type === 'frontline' ? 'frontline' : 'student'
  }
  if (studentForm.verificationType === 'frontline')
    resetEducationEmailProof()
  if (!editingVerification.value)
    persistLocalDraft(studentDraftKey, studentForm)
}

onMounted(() => {
  initializeStudentForm()
})

onUnmounted(() => {
  if (studentLetterTimer)
    clearInterval(studentLetterTimer)
})
</script>

<template>
  <section class="student-create-page">
    <div class="student-create-shell">
      <header class="student-create-hero">
        <button class="resource-back-button" type="button" title="返回列表" @click="cancelCreate">
          <span class="i-carbon-chevron-left" />
        </button>
        <div class="min-w-0">
          <h2 class="resource-create-title">
            {{ isSupplementMode ? '补充认证资料' : '提交认证申请' }}
          </h2>
          <p class="student-create-subtitle">
            {{ isSupplementMode ? '根据审核意见更新资料，重新提交后会回到待审核队列，不重复扣除审核费。' : '认证是可选辅助材料，只提高申请通过率和审核优先级；未认证也可以正常提交资源申请。' }}
          </p>
        </div>
      </header>

      <div v-if="!currentUser" class="student-create-state">
        登录后可以申请认证。
      </div>
      <div v-else-if="!isSupplementMode && !isVerificationEntryOpen" class="student-create-state student-create-state--warning">
        {{ verificationClosedReason }}
      </div>

      <div v-else class="student-create-layout">
        <main class="student-create-main">
          <section v-if="currentStep === 'notice'" class="student-create-form-panel student-create-notice-panel">
            <div class="student-create-section-heading">
              <span>开始前确认</span>
              <h3>确认材料规则后开始填写</h3>
              <p>请先确认材料由你自愿提交，并已按需脱敏；继续后进入左侧表单填写认证信息。</p>
            </div>

            <DataNotice mode="full" title="认证申请与材料免责确认" timing="before" />

            <label class="consent-check">
              <TxCheckbox v-model="hasStudentConsent" variant="checkmark" aria-label="同意认证申请与材料免责确认" />
              <span>我确认认证资料由我自愿提供，已按需脱敏；继续填写即表示同意提交成功后生成云端记录、审核费规则、管理员审核处理和上述免责说明。</span>
            </label>

            <div class="student-create-submit-bar">
              <span class="student-create-submit-note">右侧流程进度可点击切换；审核流转会在提交后进入。</span>
              <TxButton variant="primary" :disabled="!hasStudentConsent || (!isSupplementMode && !isVerificationEntryOpen)" @click="continueToDetails">
                继续填写
              </TxButton>
            </div>
          </section>

          <section v-else class="student-create-form-panel">
            <div class="student-create-form-head">
              <div>
                <span>当前规则</span>
                <h3>{{ isSupplementMode ? `${currentVerificationLabel} · 补充资料 · 不重复扣费` : `${currentVerificationLabel} · 审核费 ${STUDENT_REVIEW_FEE} 积分 · 通过后返还` }}</h3>
              </div>
              <span class="student-create-draft-badge">草稿已本地保存</span>
            </div>

            <div class="student-create-form-section">
              <div class="student-create-section-heading">
                <span>基础信息</span>
                <h3>身份和认证范围</h3>
              </div>
              <div class="student-create-field-grid">
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
                <div class="verification-form-field gap-2 grid">
                  <span class="field-label">{{ isStudentVerification ? '年级' : '服务周期' }}</span>
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
            </div>

            <div v-if="isStudentVerification" class="student-create-form-section">
              <div class="student-create-section-heading student-create-heading-row">
                <div>
                  <span>邮箱证明</span>
                  <h3>学校/科研机构邮箱邮件证明</h3>
                </div>
                <span class="student-create-help" tabindex="0" aria-label="查看邮箱证明说明">
                  <span class="i-carbon-help" />
                  <span class="student-create-help-popover">
                    支持 .edu、.edu.cn、.ac.cn、.ac.uk、.edu.au、mails.ucas.ac.cn 等域名；请用该邮箱向 {{ EDUCATION_EMAIL_REVIEW_INBOX }} 发送模板邮件，管理员会结合收件验证和人工复核处理。
                  </span>
                </span>
              </div>
              <div class="gap-3 grid">
                <div class="student-create-email-row">
                  <label class="gap-2 grid">
                    <span class="field-label">教育邮箱</span>
                    <TxInput v-model="studentForm.educationEmail" type="email" placeholder="name@school.edu.cn / name@mails.ucas.ac.cn，可选" />
                  </label>
                  <div class="student-create-email-actions">
                    <TxButton variant="secondary" :disabled="!studentForm.educationEmail" @click="onCopyEducationEmailTemplate">
                      复制模板
                    </TxButton>
                    <TxButton variant="primary" :disabled="!educationEmailVerificationForm.challengeId || educationEmailVerificationForm.verified || educationEmailVerificationForm.verifying" @click="onConfirmEducationEmailSent">
                      {{ educationEmailVerificationForm.verified ? '已验证' : educationEmailVerificationForm.verifying ? '校验中' : '校验' }}
                    </TxButton>
                  </div>
                </div>
                <p v-if="educationEmailProfileHint" class="student-create-email-status">
                  {{ educationEmailProfileHint }}
                </p>
                <p v-if="educationEmailVerificationForm.subject" class="field-hint">
                  邮件主题：{{ educationEmailVerificationForm.subject }}
                </p>
                <p v-if="educationEmailVerificationForm.message" class="field-hint text-emerald-700 dark:text-emerald-300">
                  {{ educationEmailVerificationForm.message }}
                </p>
              </div>
            </div>

            <div class="student-create-form-section">
              <div class="flex flex-wrap gap-2 items-center justify-between">
                <div class="student-create-section-heading">
                  <span>提交内容</span>
                  <h3>{{ isSupplementMode ? '本次补充说明' : '材料说明' }}</h3>
                </div>
                <span class="field-hint">所见即所得 · 草稿已本地保存</span>
              </div>
              <RichTextEditor
                v-model="studentForm.notes"
                :min-height="260"
                :placeholder="isSupplementMode ? '只填写本次新增或修正的补充资料；原提交内容会保留在右侧，提交后按时间追加到材料记录下方。' : '请说明身份背景、材料清单和需要管理员注意的补充信息。建议脱敏填写，不要提交身份证件原图、密码、密钥或涉密科研材料。'"
              />
            </div>

            <div class="student-create-form-section">
              <div class="mb-2 flex gap-3 items-center justify-between">
                <div class="student-create-section-heading">
                  <span>证明材料</span>
                  <h3>上传认证材料</h3>
                </div>
                <span class="field-hint">{{ formatBytes(totalStudentBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
              </div>
              <FileUploader v-model="studentFiles" :max="12" button-text="上传材料" drop-text="拖拽证明材料" hint-text="支持任意材料，总大小 200MB 内" />
              <p class="field-hint mt-2">
                {{ isSupplementMode ? `原记录已保留 ${editingVerification?.attachments.length ?? 0} 个材料；本次上传会追加保存。建议遮挡证件号、人脸、家庭住址、二维码等非必要信息。` : '证明材料会在认证提交成功后随记录保存；建议遮挡证件号、人脸、家庭住址、二维码等非必要信息。' }}
              </p>
            </div>

            <div class="student-create-submit-bar">
              <span class="student-create-submit-note">
                <template v-if="isSupplementMode">
                  补充提交不会再次扣除审核费；管理员会基于原材料和本次补充继续审核。
                </template>
                <template v-else>
                  提交后会立即扣除 <b class="student-create-fee-highlight">{{ STUDENT_REVIEW_FEE }} 积分</b> 作为审核费；审核通过后自动返还。
                </template>
              </span>
              <div class="student-create-submit-actions">
                <TxButton variant="ghost" @click="cancelCreate">
                  取消
                </TxButton>
                <TxButton variant="primary" @click="onSubmitStudentVerification">
                  {{ isSupplementMode ? '提交补充资料' : '提交认证' }}
                </TxButton>
              </div>
            </div>
          </section>
        </main>

        <aside class="student-create-aside">
          <section class="student-create-side-section">
            <h3>流程进度</h3>
            <div class="student-create-flow">
              <button
                v-for="(step, index) in verificationFlowSteps"
                :key="step.key"
                type="button"
                class="student-create-flow-step"
                :class="[`is-${step.status}`, { 'is-clickable': step.key !== 'review' }]"
                :disabled="step.key === 'review'"
                @click="goVerificationFlowStep(step.key)"
              >
                <span class="student-create-flow-index">
                  <span v-if="step.status === 'done'" class="i-carbon-checkmark" />
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <span class="student-create-flow-copy">
                  <b>{{ step.title }}</b>
                  <small>{{ step.description }}</small>
                </span>
              </button>
            </div>
          </section>

          <section v-if="isSupplementMode && editingVerification?.reply" class="student-create-side-section student-create-side-section--warning">
            <h3>审核补充要求</h3>
            <RichTextView :content="editingVerification.reply" class="rich-text-preview" />
          </section>

          <section v-if="isSupplementMode && editingVerification" class="student-create-side-section">
            <h3>此前提交内容</h3>
            <p class="field-hint">
              {{ formatDate(editingVerification.createdAt) }} 提交 · {{ editingVerification.attachments.length }} 个材料
            </p>
            <RichTextView :content="editingVerification.notes" class="rich-text-preview mt-3" />
            <VerificationAttachmentGrid v-if="editingVerification.attachments.length" :files="editingVerification.attachments" />
          </section>
        </aside>
      </div>
    </div>

    <div v-if="isStudentLetterOpen" class="student-letter-overlay" role="dialog" aria-modal="true" aria-labelledby="student-letter-title">
      <section class="student-letter-dialog">
        <header class="student-letter-header">
          <span>进入填写认证前</span>
          <h3 id="student-letter-title">
            给正在申请学生认证的同学
          </h3>
          <p>
            请滚动阅读至底部，并至少停留 5 秒后继续填写。
          </p>
        </header>

        <div class="student-letter-body" @scroll="onStudentLetterScroll">
          <p>亲爱的同学：</p>
          <p>你好。</p>
          <p>
            如果你正在看到这段文字，可能说明你对我们的公益项目有一点兴趣，也可能还有一些犹豫：<br>我是否需要填写学校信息？<br>这些信息会不会被别人看到？<br>平台会不会因为我的学校、学历、专业、地区，而区别对待我？
          </p>
          <p>我们想认真地告诉你：<strong>不会。</strong></p>
          <p>这个项目从一开始就不是为了评价谁的学校更好，也不是为了给任何人贴上“优秀”或“不优秀”的标签。我们做学生认证，只是为了确认申请人确实是学生身份，方便我们把有限的公益资源尽可能准确、公平地发放给真正需要的同学。</p>
          <p>我们理解，每个人都有自己的处境。有人来自重点大学，有人来自普通本科、专科、民办院校，也有人正在自考、升学、转专业、找工作，或者只是暂时还没找到特别清晰的方向。我们不认为这些标签可以定义一个人，更不会用学校层次去判断一个人是否值得被帮助。</p>
          <p>在这里，学生认证的意义只有一个：<strong>确认身份，而不是评价学历。</strong></p>
          <p>你提交的信息将只用于认证、审核和公益资源发放相关流程。我们会尽力减少不必要的信息收集，也会认真保护你的隐私。除非获得你的明确同意，或因法律法规要求，我们不会公开你的学校、个人身份信息或申请内容。</p>
          <p>我们也知道，愿意申请帮助本身就需要一点勇气。很多同学可能会担心“会不会丢脸”“会不会被看不起”“会不会因为学校普通就不被重视”。所以我们更想说：请不要这样看待自己。</p>
          <p>每个人都可能在某个阶段需要支持。接受帮助不是软弱，也不是失败。相反，它可能是你认真面对生活、继续向前走的一种方式。</p>
          <p>这个公益项目希望传递的不是优越感，而是连接、信任和善意。我们希望它能成为一个让同学们安心申请、安心使用、安心成长的地方。</p>
          <p>无论你来自哪所学校、哪个专业、哪个城市，只要你是真实的学生，并且符合项目规则，我们都会尽可能公平、认真地对待你的申请。</p>
          <p>谢谢你愿意信任我们，也谢谢你愿意迈出这一步。</p>
          <p>愿每一份善意，都能被温柔地送达。<br>愿每一个正在努力的同学，都不必因为标签而怀疑自己。</p>
          <p class="student-letter-signature">
            —— TouchWelfare * Thanks to LinuxDo
          </p>
        </div>

        <footer class="student-letter-footer">
          <span v-if="!hasStudentLetterScrolled">请先滚动到信件底部</span>
          <span v-else-if="studentLetterRemainingSeconds > 0">还需等待 {{ studentLetterRemainingSeconds }} 秒</span>
          <span v-else>已完成阅读确认</span>
          <TxButton variant="primary" :disabled="!canConfirmStudentLetter" @click="confirmStudentLetter">
            我已阅读，继续填写
          </TxButton>
        </footer>
      </section>
    </div>
  </section>
</template>
