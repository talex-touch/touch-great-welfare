<script setup lang="ts">
import { FileUploader, TxButton, TxCard, TxCheckbox, TxInput, TxStep, TxSteps } from '@talex-touch/tuffex'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import {
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  STUDENT_REVIEW_FEE,
} from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'

const {
  currentUser,
  educationEmailVerificationForm,
  studentForm,
  studentCategoryOptions,
  studentFiles,
  studentGradeOptions,
  studentSchoolSuggestions,
  totalStudentBytes,
  submitStudentVerification,
  resetStudentFiles,
  requestEducationEmailCode,
  confirmEducationEmailCode,
} = useWelfareUiState()

const router = useRouter()
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

const filteredStudentGradeOptions = computed(() => [...studentGradeOptions])

function continueToDetails() {
  currentStep.value = 'details'
}

function backToNotice() {
  currentStep.value = 'notice'
}

function cancelCreate() {
  router.push('/dashboard/student')
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
  runSafely(() => {
    submitStudentVerification({
      category: studentForm.category,
      school: studentForm.school,
      identity: studentForm.identity,
      grade: studentForm.grade,
      educationEmail: studentForm.educationEmail,
      educationEmailCode: educationEmailVerificationForm.code,
      notes: studentForm.notes,
      attachments: studentFiles.value,
    })
    resetStudentFiles()
    clearLocalDraft(studentDraftKey)
    router.push('/dashboard/student')
  }, `学生认证已提交并扣除 ${STUDENT_REVIEW_FEE} 积分审核费`)
}

function onRequestEducationEmailCode() {
  runSafely(async () => {
    await requestEducationEmailCode()
  }, '教育邮箱验证码已发送')
}

function onConfirmEducationEmailCode() {
  runSafely(async () => {
    await confirmEducationEmailCode()
  }, '教育邮箱已完成验证码校验')
}

onMounted(() => {
  restoreLocalDraft(studentDraftKey, studentForm)
  persistLocalDraft(studentDraftKey, studentForm)
})
</script>

<template>
  <section class="space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="24" :radius="28">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div>
          <h2 class="text-3xl fw-900 tracking-tight">
            提交学生认证
          </h2>
          <p class="text-sm text-slate-500 leading-6 mt-2 dark:text-slate-400">
            先确认材料处理边界，再填写认证信息。草稿会保存在本地浏览器。
          </p>
        </div>
        <TxButton variant="ghost" @click="cancelCreate">
          返回列表
        </TxButton>
      </div>

      <TxSteps :active="activeStep" class="mt-6" size="small">
        <TxStep title="确认说明" description="自愿提交 / 7 天保留" />
        <TxStep title="填写认证" description="所见即所得编辑" />
        <TxStep title="审核流转" description="扣费 / 审核 / 返还" />
      </TxSteps>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        登录后可以申请学生认证。
      </div>

      <div v-else class="mt-6 space-y-6">
        <template v-if="currentStep === 'notice'">
          <DataNotice mode="full" title="学生认证与材料免责确认" timing="before" />
          <label class="consent-check">
            <TxCheckbox v-model="hasStudentConsent" variant="checkmark" aria-label="同意学生认证与材料免责确认" />
            <span>我确认认证资料由我自愿提供，已按需脱敏；继续填写即表示同意提交成功后生成云端记录、审核费规则、管理员审核处理和上述免责说明。</span>
          </label>
          <div class="flex justify-end">
            <TxButton variant="primary" :disabled="!hasStudentConsent" @click="continueToDetails">
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
                审核费 {{ STUDENT_REVIEW_FEE }} 积分 · 通过后返还
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

          <div class="gap-5 grid md:grid-cols-2">
            <div class="gap-2 grid">
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
                    v-for="category in studentCategoryOptions"
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
            <div class="gap-2 grid">
              <span class="field-label">学校 / 组织</span>
              <div class="school-combobox">
                <TxInput
                  v-model="studentForm.school"
                  placeholder="输入学校名称，或选择保密 / 内置学校"
                  @focus="openSchoolSuggestions"
                  @input="openSchoolSuggestions"
                  @blur="closeSchoolSuggestionsSoon"
                >
                  <template #suffix>
                    <span class="i-carbon-chevron-down text-slate-500" />
                  </template>
                </TxInput>
                <div v-if="isSchoolSuggestionsOpen && filteredStudentSchoolSuggestions.length" class="school-suggestions-panel">
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
              <div class="gap-2 grid">
                <span class="field-label">年级</span>
                <div class="school-combobox">
                  <TxInput
                    v-model="studentForm.grade"
                    placeholder="可选择年级，也可自行输入"
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
            <div class="gap-2 grid md:col-span-2">
              <label class="gap-2 grid">
                <span class="field-label">教育邮箱</span>
                <TxInput v-model="studentForm.educationEmail" type="email" placeholder="name@school.edu.cn，可选" />
              </label>
              <div class="gap-3 grid md:grid-cols-[1fr_auto_auto]">
                <TxInput v-model="educationEmailVerificationForm.code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" />
                <TxButton variant="secondary" :disabled="educationEmailVerificationForm.loading || !studentForm.educationEmail" @click="onRequestEducationEmailCode">
                  {{ educationEmailVerificationForm.loading ? '发送中' : '发送验证码' }}
                </TxButton>
                <TxButton variant="primary" :disabled="educationEmailVerificationForm.loading || !educationEmailVerificationForm.code" @click="onConfirmEducationEmailCode">
                  校验邮箱
                </TxButton>
              </div>
              <p class="field-hint">
                如果有学校或机构邮箱，验证码校验可作为辅助证明；管理员仍会人工复核材料。不方便公开或受学校/机构要求限制时可以留空。
              </p>
              <p v-if="educationEmailVerificationForm.message" class="field-hint" :class="educationEmailVerificationForm.verified ? 'text-emerald-700 dark:text-emerald-300' : ''">
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
                证明材料会在认证提交成功后随记录保存；建议遮挡证件号、人脸、家庭住址、二维码等非必要信息。
              </p>
            </div>
          </div>

          <div class="text-sm text-amber-800 leading-6 p-5 border border-amber-400/25 rounded-3xl bg-amber-50 dark:text-amber-200 md:col-span-2">
            提交后会立即扣除 {{ STUDENT_REVIEW_FEE }} 积分作为审核费；如果审核通过，系统自动返还这 {{ STUDENT_REVIEW_FEE }} 积分。确认提交即视为同意本次规则和数据处理说明。
          </div>

          <div class="flex gap-3 justify-end">
            <TxButton variant="ghost" @click="cancelCreate">
              取消
            </TxButton>
            <TxButton variant="primary" @click="onSubmitStudentVerification">
              提交认证
            </TxButton>
          </div>
        </template>
      </div>
    </TxCard>
  </section>
</template>
