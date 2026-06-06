<script setup lang="ts">
import type { ResourceTermId, ResourceType } from '~/composables/welfare'
import { TxButton, TxCard, TxCheckbox, TxDatePicker, TxFileUploader, TxInput, TxNumberInput, TxSelect, TxSelectItem, TxSlider } from '@talex-touch/tuffex'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { ACTIVITY_NAME, calculateActivityPrice, calculateLlmApiBudgetActivityPrice, calculateLlmApiCostPoints, calculateLlmApiRateLimitChangeCost, canApplyResourceType, formatBytes, LLM_API_MODEL_COST_MULTIPLIERS, llmApiBudgetActivityDiscountRate, MAX_ACTIVE_USER_REQUESTS, MAX_ATTACHMENT_BYTES, RESOURCE_DEFAULT_DURATION, RESOURCE_DURATION_EXTENSION_COST, SQUARE_SHARE_DISCOUNT_RATE } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import TurnstileChallenge from './TurnstileChallenge.vue'

const {
  currentUser,
  applicationSecurityForm,
  applicationFiles,
  resourceApplicationForm,
  resourceApplicationItems,
  resourceTypeConfigs,
  selectedResourceTerms,
  resourceApplicationPolicyStatus,
  availableCurrentUserCoupons,
  totalApplicationBytes,
  activeRequestCount,
  canCreateRequest,
  selectableLlmApiModels,
  userLevelCard,
  submitResourceApplication,
  addResourceApplicationItem,
  removeResourceApplicationItem,
  ensureSelectedResourceItems,
  resetResourceApplicationForm,
  resetApplicationFiles,
  resetApplicationSecurity,
  setApplicationTurnstileToken,
} = useWelfareUiState()

const router = useRouter()
const { runSafely } = useWelfareFeedback()
const currentStep = ref<'types' | 'materials' | 'terms'>('types')
const expectedDatePickerVisible = ref(false)
const isTermsDialogOpen = ref(false)
const activeResourceTermTab = ref<ResourceTermId | ''>('')
const expectedEffectivePreset = ref('after_approval')
const applicationDraftKey = 'welfare:resource-application-draft'
let previousBodyOverflow = ''
let previousHtmlOverflow = ''
const activeStep = computed(() => currentStep.value === 'types' ? 0 : currentStep.value === 'materials' ? 1 : 2)
const currentUserLevelPriority = computed(() => currentUser.value ? userLevelCard(currentUser.value.id).priority : 0)
const visibleResourceTypeConfigs = computed(() => resourceTypeConfigs.value.filter(config => isResourceTypeAvailable(config.resourceType)))
const activeResourceTerm = computed(() =>
  selectedResourceTerms.value.find(term => term.id === activeResourceTermTab.value)
  ?? selectedResourceTerms.value[0],
)
const resourceStepItems = computed(() => [
  { key: 'types', title: '选择类型', description: '可多选资源' },
  { key: 'materials', title: '填写材料', description: '分组添加明细' },
  { key: 'terms', title: '结算单', description: '核对预扣' },
])
const resourceTermDetailMap: Record<ResourceTermId, string[]> = {
  general_resource_terms: [
    '适用范围：本条款适用于平台向申请人临时或定向提供的数据库、模型额度、网络访问、计算、存储、仓库、流水线等全部资源。申请人提交申请即视为确认资源仅用于申请单中写明的公益、研发、学习、开源或经审批认可的相关场景。',
    '主体确认：申请人确认其具备提交申请、使用资源、处理相关数据和承担费用责任的必要资格、授权和真实身份信息；若申请人代表团队、项目或组织提交申请，应确保已取得相应授权并对团队成员使用行为承担管理责任。',
    '使用限制：申请人不得将资源转借、倒卖、出租、共享、外包给第三方使用，不得将账号、密钥、令牌、临时权限、白名单、额度或审批结果用于与申请无关的业务，也不得通过拆分申请、多人代申、伪造用途等方式绕过额度、等级、次数或审核限制。',
    '资料真实性：申请人提交的申请理由、项目背景、附件、外链、身份信息、成本归属、资源数量、使用场景和预估消耗应真实、准确、完整、合法。因虚假、遗漏、误导性陈述或无法证明必要性导致的审核拒绝、封禁或资源回收，申请人自行承担后果。',
    '责任承担：申请人应对资源账号、密钥、临时权限、调用额度、产生费用、访问行为、数据处理行为和由此引发的风险负责。负责人、用途、成本归属、项目边界或实际使用人发生变化时，应主动补充说明或重新提交申请。',
    '合规承诺：申请人承诺遵守适用法律法规、平台规则、第三方供应商服务条款、开源许可证、数据保护要求、安全规范和社区准则，不得利用资源从事违法违规、侵权、欺诈、骚扰、垃圾信息、攻击破坏或损害平台声誉的行为。',
    '到期与回收：资源到期、项目结束、审批人要求回收、平台容量不足或发现异常风险时，申请人应立即停止使用并释放资源，包括但不限于删除临时凭据、关闭实例、移除白名单、撤销仓库权限、清理命名空间和停止继续消耗额度。',
    '平台调整权：平台可基于资源余量、成本波动、供应商限制、风控结果、政策变化、服务维护、不可抗力或公共利益需要，对资源额度、期限、折扣、审批条件、开通方式和回收规则进行调整、暂停或终止。',
    '审计与留存：平台可保留必要的申请记录、审批记录、资源快照、调用日志、操作日志、举报记录、费用流水和风控结果，用于审核、复盘、审计、成本核算、安全调查、反滥用和争议处理。非必要材料按平台保留策略清理。',
    '风险自担：资源可能受供应商可用性、网络环境、模型策略、云平台限制、维护窗口、配额不足或第三方封禁影响。平台不承诺资源连续可用、完全适配申请目的或满足特定收益预期。',
    '违约处置：申请人违反本条款、提交虚假材料、隐瞒实际用途、滥用资源、造成安全风险、产生异常成本或违反第三方服务政策时，平台可无需事先通知而暂停申请、回收资源、撤销权限、作废优惠、限制再次申请或直接封禁账号。',
    '积分与退款：因违规、滥用、虚假申请、第三方封禁、资源回收、安全处置或管理员封禁导致服务中止的，平台不退还任何已预扣积分、已消费积分、审核费用、加速费用、活动优惠、优惠券价值或因资源占用产生的成本。',
    '后台封禁：管理员可在后台基于申请记录、日志、举报、审计结果、供应商反馈或安全事件封禁用户。被封禁用户不得继续提交申请、复用额度、参与广场互动、领取奖励、申请退款或要求恢复已回收资源。',
    '损失限制：在适用法律允许范围内，平台对间接损失、利润损失、业务中断、数据丢失、第三方索赔、模型输出错误、资源不可用或申请未通过不承担赔偿责任；申请人应自行做好备份、验证和风险控制。',
    '追偿与协助：因申请人违规使用资源导致平台、供应商、其他用户或第三方遭受投诉、处罚、损失、成本、律师费或调查支出的，平台有权要求申请人说明情况、配合调查、停止侵害并承担相应责任。',
  ],
  database_security_terms: [
    '权限原则：数据库权限按照最小权限、最短期限、明确范围发放。默认不开放跨库访问、生产写入、批量导出、权限转授、管理员权限、结构变更、数据恢复、备份下载或绕过审计的直接连接。',
    '敏感范围：涉及生产环境、用户信息、订单、支付、财务、日志、身份凭证、隐私字段、业务密钥、未公开数据或其他敏感数据时，申请人必须说明访问对象、字段范围、操作目的、预计影响、脱敏方式和回收时间。',
    '数据分类：申请人应在访问前识别数据是否包含个人信息、敏感个人信息、商业秘密、业务配置、访问凭据、交易记录、行为日志或受监管数据；无法判断时应按更高敏感级别处理。',
    '禁止行为：申请人不得复制、传播、截图、外发、长期保存、二次加工或用于训练未获授权的数据；不得使用脚本批量爬取、撞库、枚举、绕过限流、规避脱敏策略或通过临时权限扩大访问范围。',
    '本地保存限制：除申请单明确允许外，申请人不得将数据库内容下载到个人设备、网盘、聊天工具、第三方 SaaS、非受控存储或公共代码仓库。临时缓存、导出文件、截图和中间结果应在用途完成后立即清理。',
    '变更与写入：任何生产写入、结构调整、索引变更、批量更新、删除、迁移、恢复、权限升级或对业务稳定性有影响的操作，应单独说明并取得审批人确认；未写明的操作即视为未授权。',
    '脱敏与最小化：申请人应仅查询完成目的所必需的字段、行数和时间范围。展示、分析、调试、共享或提交结果时，应优先使用脱敏、聚合、抽样或伪造数据，不得暴露可识别个人或业务敏感信息。',
    '安全事件：发现异常查询、误操作、权限泄露、凭据遗失、数据错删、数据外泄、疑似撞库、异常导出或其他安全风险时，申请人应立即停止操作，保留现场信息，并联系审批组或管理员复盘。',
    '审计配合：平台可记录数据库连接、查询摘要、权限变更、资源开通、回收、导出申请和相关审批记录。申请人应配合管理员说明实际使用行为，不得删除、伪造、规避或干扰审计记录。',
    '第三方限制：未经审批，申请人不得将数据库内容提供给外包、供应商、模型服务、分析平台、公开演示环境或其他第三方处理；确需第三方处理时，应说明处理目的、范围、保密措施和删除计划。',
    '备份与恢复：申请人不得私自创建、下载、复制、恢复或迁移备份，不得通过快照、Binlog、逻辑导出、缓存转储等方式绕过权限范围获取数据。',
    '合规责任：因申请人违反数据保护、隐私、保密、行业监管或合同义务产生的投诉、处罚、审计失败、第三方索赔或业务损失，由申请人承担解释、补救和责任后果。',
    '违规后果：因违规访问、越权查询、泄露、传播、滥用数据或未按要求上报导致风险的，平台可立即撤销权限、封禁账号、通知相关审批人并保留追溯处理权；相关预扣积分、已消费积分和审核费用均不退还。',
  ],
  llm_api_compliance_terms: [
    '适用范围：本条款适用于平台提供的大模型 API 额度、临时 Key、模型调用权限、RPM、TPM、预算、并发、IP 限制和相关管理能力。申请人仅可在申请单写明的项目、场景和期限内使用。',
    '输入限制：申请人不得向模型上传未脱敏的个人隐私、身份证件、联系方式、访问密钥、Token、商业机密、未公开数据、受限代码、受版权或保密限制的材料，或违反模型供应商、平台、法律法规及社区规范的内容。',
    '内容安全：申请人不得使用模型生成、改写、传播或自动化分发违法违规、侵权、仇恨、骚扰、欺诈、垃圾信息、恶意代码、钓鱼、绕过安全限制、武器化攻击、虚假身份、深度伪造或其他高风险内容。',
    '额度限制：额度、预算、RPM、TPM、并发、IP 和有效期不得共享、倒卖、转租、代理、转接给第三方，不得用于刷量、批量注册、绕过风控、爬虫、攻击、垃圾内容生成、诱导违规输出或任何未在申请中说明的业务。',
    '密钥保管：申请人应妥善保管临时 Key、调用地址、代理配置和访问凭据，不得写入公开仓库、前端代码、日志、截图、聊天记录或第三方平台。发现泄露或异常调用时应立即停用并通知管理员。',
    '输出责任：模型输出仅作为辅助结果，申请人应自行核验准确性、合法性、版权状态、安全性和适用性。不得将未经人工复核的输出直接用于医疗、法律、金融、学术发表、生产决策、安全控制或其他高风险场景。',
    '知识产权：申请人应确保输入材料和使用输出不侵犯他人著作权、商标权、商业秘密、肖像权、隐私权或其他合法权益。模型输出不当然视为可商用、可发表或无权利负担。',
    '自动化使用：申请人使用模型进行批量处理、自动回复、Agent 调用、工具执行、代码修改、数据分析或对外服务时，应设置合理限流、日志、人工复核、失败回滚和安全边界。',
    '日志与风控：平台可按申请记录留存调用摘要、额度消耗、异常峰值、IP、时间、模型、风控命中和审计结果，用于排查滥用、成本异常、安全事件和供应商合规要求。必要时平台可限制、降额或暂停 Key。',
    '供应商处置：若模型供应商、上游服务、风控系统或管理员认定存在违规、滥用、异常消耗、违反使用政策或触发封禁风险，平台可立即停止调用权限、回收临时 Key、封禁用户并追溯关联账号。',
    '高风险场景：涉及未成年人、医疗建议、法律意见、金融投资、身份认证、安全漏洞、公共舆论、招聘录取、信贷评分或其他可能影响个人权益的场景，应取得额外审批并保留人工审查记录。',
    '费用承担：因违反供应商或平台使用政策导致账号、Key、项目、模型额度或用户被封禁、暂停、限流、回收或产生额外成本的，平台不退还任何积分、优惠或费用，申请人需对异常消耗和关联后果负责。',
  ],
  infrastructure_resource_terms: [
    '资源范围：本条款适用于服务器、GPU、K8s Namespace、对象存储、VPN、IP 白名单、CI/CD、Git 仓库、运行环境、镜像、网络访问和其他基础设施资源。资源仅可用于申请单写明的项目和环境。',
    '部署限制：申请人不得挖矿、转租、搭建公开代理、部署恶意程序、扫描或压测未授权系统、攻击第三方、规避安全策略、绕过访问控制、运行违规服务或将资源用于高风险公开暴露场景。',
    '访问控制：申请人应使用强密码、密钥轮换、最小端口开放、最小角色权限和必要的 IP 限制，不得共享 SSH Key、Kubeconfig、Access Key、Runner Token、部署密钥或其他可复用凭据。',
    '配置责任：申请人应遵守镜像、端口、访问控制、密钥管理、日志、存储、备份、网络隔离和安全组要求。因配置不当、凭据泄露、服务暴露、弱口令或未及时修复漏洞导致的风险由申请人承担。',
    '网络与对外服务：未经审批，申请人不得开放数据库、管理面板、代理、隧道、文件服务、对象存储公网读写、Webhook、Runner 或其他可能被滥用的公网入口。确需开放时，应说明范围、鉴权方式和关闭时间。',
    '成本与规格：资源规格、数量、有效期、区域、带宽、存储、GPU 型号、命名空间配额和成本归属会影响预扣积分。审批人可基于资源余量、安全风险和实际必要性调整后通过或要求补充说明。',
    '软件与许可证：申请人部署的软件、镜像、模型、数据集、依赖包和二进制文件应来源合法，不得包含盗版、恶意后门、违反许可证的组件或受出口管制、保密限制、供应商禁用的内容。',
    '数据与备份：申请人应自行判断是否需要备份、加密、脱敏、访问控制和生命周期策略。平台提供资源不等于承诺数据持久、安全备份、灾难恢复或服务连续性。',
    '回收义务：资源到期、项目结束、审批人要求回收、异常成本出现或安全事件发生时，申请人应及时释放实例、命名空间、白名单、Bucket、Runner、临时凭据、仓库权限和持续计费资源。',
    '安全处置：平台可在检测到异常流量、违规进程、攻击行为、挖矿特征、代理滥用、成本异常、供应商告警或举报时，立即停机、断网、回收资源、保存快照、暂停申请并封禁用户。',
    '供应链风险：申请人应避免在资源中运行来源不明脚本、镜像、CI 配置、Action、插件、模型权重或依赖包。因供应链污染、凭据泄露或恶意依赖引发的安全事件由申请人承担相应责任。',
    '监管与第三方投诉：若资源使用引发云平台、网络运营商、权利人、监管机构、学校、企业或第三方投诉，平台可优先采取停机、封禁、证据保全和信息披露等必要措施。',
    '违约后果：因违规部署、攻击、滥用网络、造成安全事件、违反云平台政策或产生异常成本导致资源中止、账号封禁或供应商处罚的，平台不退还任何积分、优惠或费用，并保留继续追溯处理权。',
  ],
}
const groupedResourceItems = computed(() => resourceApplicationForm.selectedResourceTypes.map(resourceType => ({
  config: resourceTypeConfigs.value.find(item => item.resourceType === resourceType),
  items: resourceApplicationItems.value.filter(item => item.resourceType === resourceType),
})).filter(group => group.config))

const databasePermissionOptions = [
  { value: 'readonly', label: '只读' },
  { value: 'readwrite', label: '读写' },
  { value: 'admin', label: '管理员' },
  { value: 'temporary_ops', label: '临时运维' },
]
const environmentOptions = ['dev', 'test', 'staging', 'prod']
const urgencyOptions = [
  { value: 'normal', label: '普通' },
  { value: 'urgent', label: '紧急' },
  { value: 'emergency', label: '应急' },
]
const expectedEffectiveOptions = [
  { value: 'after_approval', label: '审批通过后立即生效' },
  { value: 'next_workday', label: '下一个工作日' },
  { value: 'custom', label: '自定义日期时间' },
]
const rateLimitModeOptions = [
  { value: 'default', label: '使用默认 RPM / TPM' },
  { value: 'custom', label: '自定义 RPM / TPM' },
]
const llmBudgetMarks = [10, 100, 500, 1000]
const durationOptions = [
  { value: RESOURCE_DEFAULT_DURATION, label: RESOURCE_DEFAULT_DURATION },
  { value: '7 天', label: '延长至 7 天' },
  { value: '30 天', label: '延长至 30 天' },
]

function formatUsd(value: number) {
  return `$${Number(value || 0).toLocaleString('en-US')}`
}

interface ResourceDraftItem {
  resourceType: ResourceType
  payload: Record<string, any>
  requestedQuota?: string
  requestedPermission?: string
  resourceSubtype?: string
  duration?: string
}

function llmModelForItem(item: { payload: Record<string, any> }) {
  return selectableLlmApiModels.value.find(model => model.key === item.payload.model)
    ?? selectableLlmApiModels.value[0]
}

function sanitizeLlmItem(item: ResourceDraftItem) {
  const model = llmModelForItem(item)
  if (!model)
    return

  if (item.payload.model !== model.key)
    item.payload.model = model.key
  item.resourceSubtype = model.key
  item.payload.modelName = model.name
  item.payload.budgetLimit = Math.max(model.minBudgetUsd, Math.min(model.maxBudgetUsd, Number(item.payload.budgetLimit || model.defaultBudgetUsd)))
  item.payload.rpmLimit = Math.max(1, Math.trunc(Number(item.payload.rpmLimit || model.rpmLimit)))
  item.payload.tpmLimit = Math.max(1, Math.trunc(Number(item.payload.tpmLimit || model.tpmLimit)))
  item.payload.defaultRpmLimit = model.rpmLimit
  item.payload.defaultTpmLimit = model.tpmLimit
  item.payload.rateLimitMode = item.payload.rateLimitMode === 'custom' ? 'custom' : 'default'
  if (item.payload.rateLimitMode !== 'custom') {
    item.payload.rpmLimit = model.rpmLimit
    item.payload.tpmLimit = model.tpmLimit
  }
  item.payload.uploadsUserData = false
  item.payload.uploadUserData = false
  item.payload.containsSensitiveInfo = false
  item.payload.containsPrivacy = false
  item.payload.logRetention = 0
  item.payload.duration = item.payload.duration || RESOURCE_DEFAULT_DURATION
  item.requestedQuota = formatUsd(item.payload.budgetLimit)
  item.duration = item.payload.duration
}

function onLlmModelChange(item: ResourceDraftItem) {
  const model = llmModelForItem(item)
  if (!model)
    return

  item.payload.model = model.key
  item.resourceSubtype = model.key
  item.payload.modelName = model.name
  item.payload.budgetLimit = model.defaultBudgetUsd
  item.payload.rpmLimit = model.rpmLimit
  item.payload.tpmLimit = model.tpmLimit
  item.payload.defaultRpmLimit = model.rpmLimit
  item.payload.defaultTpmLimit = model.tpmLimit
  item.payload.rateLimitMode = 'default'
  item.payload.duration = item.payload.duration || RESOURCE_DEFAULT_DURATION
  item.requestedQuota = formatUsd(model.defaultBudgetUsd)
  item.duration = item.payload.duration
}

function sanitizeResourceDurations() {
  for (const item of resourceApplicationItems.value) {
    const duration = item.duration || item.payload.duration || RESOURCE_DEFAULT_DURATION
    item.duration = duration
    item.payload.duration = duration
    item.payload.durationExtensionCost = itemDurationExtensionCost(item)
    item.payload.estimatedCost = itemUndiscountedEstimate(item)
    item.payload.discountedEstimatedCost = itemDiscountedEstimate(item)
  }
}

function onRateLimitModeChange(item: ResourceDraftItem) {
  const model = llmModelForItem(item)
  if (!model || item.payload.rateLimitMode === 'custom')
    return

  item.payload.rpmLimit = model.rpmLimit
  item.payload.tpmLimit = model.tpmLimit
}

function sanitizeLlmItems() {
  for (const item of resourceApplicationItems.value) {
    if (item.resourceType === 'llm_api_quota')
      sanitizeLlmItem(item)
  }
}

function itemDurationExtensionCost(item: { duration?: string, payload: Record<string, any> }) {
  const duration = item.duration || item.payload.duration || RESOURCE_DEFAULT_DURATION
  return duration === RESOURCE_DEFAULT_DURATION ? 0 : RESOURCE_DURATION_EXTENSION_COST
}

function formatPoints(value: number) {
  return `${Math.ceil(value).toLocaleString('zh-CN')} 积分`
}

function itemModelMultiplier(item: { payload: Record<string, any> }) {
  const modelKey = String(item.payload.model || '') as keyof typeof LLM_API_MODEL_COST_MULTIPLIERS
  return LLM_API_MODEL_COST_MULTIPLIERS[modelKey] ?? 1
}

function itemBaseEstimate(item: { resourceType: ResourceType, payload: Record<string, any>, duration?: string }) {
  if (item.resourceType === 'llm_api_quota') {
    const model = llmModelForItem(item)
    return model ? calculateLlmApiCostPoints(Number(item.payload.budgetLimit || 10), model) : Number(item.payload.budgetLimit || 10) * 10 * itemModelMultiplier(item)
  }
  if (item.resourceType === 'database')
    return 1000 + (item.payload.sensitiveData ? 3000 : 0)
  return 800 * Math.max(1, Number(item.payload.quantity || 1))
}

function itemEstimateParts(item: { resourceType: ResourceType, payload: Record<string, any>, duration?: string }) {
  const base = itemBaseEstimate(item)
  const model = item.resourceType === 'llm_api_quota' ? llmModelForItem(item) : undefined
  const discountBase = item.resourceType === 'llm_api_quota'
    ? calculateLlmApiBudgetActivityPrice(base, Number(item.payload.budgetLimit || model?.defaultBudgetUsd || 10), model)
    : calculateActivityPrice(base)
  const rate = llmRateChangeCost(item)
  const duration = itemDurationExtensionCost(item)
  return {
    base,
    discountBase,
    rate,
    duration,
    original: base + rate + duration,
    discounted: discountBase + rate + duration,
    savings: Math.max(0, base - discountBase),
  }
}

function itemUndiscountedEstimate(item: ResourceDraftItem) {
  return itemBaseEstimate(item) + llmRateChangeCost(item) + itemDurationExtensionCost(item)
}

function itemDiscountedEstimate(item: ResourceDraftItem) {
  return calculateActivityPrice(itemBaseEstimate(item)) + llmRateChangeCost(item) + itemDurationExtensionCost(item)
}

const totalUndiscountedEstimate = computed(() => resourceApplicationItems.value.reduce((sum, item) => sum + itemUndiscountedEstimate(item), 0))
const totalDiscountedEstimate = computed(() => resourceApplicationItems.value.reduce((sum, item) => sum + itemDiscountedEstimate(item), 0))
const selectedResourceCoupon = computed(() => availableCurrentUserCoupons.value.find(coupon => coupon.id === resourceApplicationForm.selectedCouponId))
const couponDiscountAmount = computed(() => {
  if (!selectedResourceCoupon.value)
    return 0

  return Math.max(0, totalDiscountedEstimate.value - Math.max(1, Math.ceil(totalDiscountedEstimate.value * selectedResourceCoupon.value.discountRate)))
})
const couponPayableEstimate = computed(() => Math.max(0, totalDiscountedEstimate.value - couponDiscountAmount.value))
const squareDiscountAmount = computed(() => {
  if (!resourceApplicationForm.shareToSquare)
    return 0

  return Math.max(0, couponPayableEstimate.value - Math.max(1, Math.ceil(couponPayableEstimate.value * SQUARE_SHARE_DISCOUNT_RATE)))
})
const checkoutPayableEstimate = computed(() => Math.max(0, couponPayableEstimate.value - squareDiscountAmount.value))
const totalDiscountSavings = computed(() => Math.max(0, totalUndiscountedEstimate.value - checkoutPayableEstimate.value))
const requiredResourceTermIds = computed(() => selectedResourceTerms.value.map(term => term.id))
const hasAcceptedAllResourceTerms = computed(() =>
  requiredResourceTermIds.value.length > 0
  && requiredResourceTermIds.value.every(termId => resourceApplicationForm.acceptedTermIds.includes(termId)),
)
const resourceCheckoutRows = computed(() => resourceApplicationItems.value.map((item, index) => {
  const parts = itemEstimateParts(item)
  return {
    id: item.id,
    index: index + 1,
    type: resourceTypeConfigs.value.find(config => config.resourceType === item.resourceType)?.displayName ?? item.resourceType,
    subtype: item.resourceType === 'llm_api_quota' ? llmModelForItem(item)?.name ?? item.resourceSubtype : item.resourceSubtype,
    details: resourceCheckoutDetails(item),
    duration: item.duration || item.payload.duration || RESOURCE_DEFAULT_DURATION,
    base: parts.base,
    rate: parts.rate,
    durationCost: parts.duration,
    original: parts.original,
    discounted: parts.discounted,
    savings: parts.savings,
  }
}))
const isResourceSubmissionBlocked = computed(() =>
  !canCreateRequest.value
  || resourceApplicationForm.acceptedTermIds.length !== selectedResourceTerms.value.length
  || !resourceApplicationPolicyStatus.value.available
  || !resourceApplicationPolicyStatus.value.descriptionOk
  || (resourceApplicationPolicyStatus.value.turnstileEnabled && !applicationSecurityForm.turnstileToken),
)

function pad2(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

function todayYmd() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function splitDateTime(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/)
  return {
    date: match?.[1] || '',
    time: match?.[2] || '',
  }
}

function joinDateTime(date: string, time: string) {
  if (!date)
    return ''

  return time ? `${date} ${time}` : date
}

const expectedDateValue = computed({
  get: () => splitDateTime(resourceApplicationForm.expectedEffectiveAt).date,
  set: (date: string) => {
    resourceApplicationForm.expectedEffectiveAt = joinDateTime(date, splitDateTime(resourceApplicationForm.expectedEffectiveAt).time)
  },
})
const expectedTimeValue = computed({
  get: () => splitDateTime(resourceApplicationForm.expectedEffectiveAt).time,
  set: (time: string) => {
    resourceApplicationForm.expectedEffectiveAt = joinDateTime(expectedDateValue.value || todayYmd(), time)
  },
})

watch(availableCurrentUserCoupons, () => {
  if (resourceApplicationForm.selectedCouponId && !selectedResourceCoupon.value)
    resourceApplicationForm.selectedCouponId = ''
})

watch(selectedResourceTerms, (terms) => {
  if (!terms.length) {
    activeResourceTermTab.value = ''
    isTermsDialogOpen.value = false
    return
  }

  if (!terms.some(term => term.id === activeResourceTermTab.value))
    activeResourceTermTab.value = terms[0].id
})

watch(selectableLlmApiModels, sanitizeLlmItems)
watch(isTermsDialogOpen, setTermsDialogScrollLock)

function applyExpectedEffectivePreset(value: string | number) {
  const preset = String(value)
  expectedEffectivePreset.value = preset
  if (preset === 'after_approval') {
    resourceApplicationForm.expectedEffectiveAt = ''
    return
  }

  if (preset === 'next_workday') {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    while ([0, 6].includes(date.getDay()))
      date.setDate(date.getDate() + 1)
    resourceApplicationForm.expectedEffectiveAt = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} 09:00`
  }
}

function sanitizeDefaultFormChoices() {
  if (!urgencyOptions.some(item => item.value === resourceApplicationForm.urgency))
    resourceApplicationForm.urgency = 'normal'

  if (resourceApplicationForm.expectedEffectiveAt)
    expectedEffectivePreset.value = 'custom'
  else
    expectedEffectivePreset.value = 'after_approval'
}

function couponDiscountText(rate: number) {
  return `${Number(rate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
}

function rateDiscountText(rate: number) {
  return `${Number(rate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
}

function itemActivityDiscountRate(item: { resourceType: ResourceType, payload: Record<string, any> }) {
  if (item.resourceType !== 'llm_api_quota')
    return 0.01

  const model = llmModelForItem(item)
  return llmApiBudgetActivityDiscountRate(Number(item.payload.budgetLimit || model?.defaultBudgetUsd || 10), model)
}

function itemActivityDiscountText(item: { resourceType: ResourceType, payload: Record<string, any> }) {
  const rate = itemActivityDiscountRate(item)
  return rate >= 1 ? '不打折' : `${rateDiscountText(rate)}优惠`
}

function resourceCheckoutDetails(item: ResourceDraftItem) {
  if (item.resourceType === 'llm_api_quota') {
    const model = llmModelForItem(item)
    const rpm = Number(item.payload.rpmLimit || model?.rpmLimit || 0).toLocaleString('zh-CN')
    const tpm = Number(item.payload.tpmLimit || model?.tpmLimit || 0).toLocaleString('zh-CN')
    return [
      `额度 ${formatUsd(Number(item.payload.budgetLimit || model?.defaultBudgetUsd || 0))}`,
      `RPM ${rpm}`,
      `TPM ${tpm}`,
      item.payload.rateLimitMode === 'custom' ? '自定义限流' : '默认限流',
    ]
  }

  if (item.resourceType === 'database') {
    return [
      item.payload.name ? `实例 ${item.payload.name}` : '',
      `环境 ${item.payload.environment || '-'}`,
      `权限 ${item.requestedPermission || item.payload.permission || '-'}`,
      item.payload.sensitiveData ? '含敏感数据' : '不含敏感数据',
    ].filter(Boolean)
  }

  return [
    item.payload.specification ? `规格 ${item.payload.specification}` : '',
    `数量 ${Number(item.payload.quantity || 1).toLocaleString('zh-CN')}`,
    `环境 ${item.payload.environment || '-'}`,
    item.payload.project ? `项目 ${item.payload.project}` : '',
  ].filter(Boolean)
}

function openExpectedDatePicker() {
  expectedDatePickerVisible.value = true
}

function llmRateChangeCost(item: { payload: Record<string, any> }) {
  const model = llmModelForItem(item)
  if (!model)
    return 0

  return calculateLlmApiRateLimitChangeCost(
    Number(item.payload.rpmLimit || model.rpmLimit),
    Number(item.payload.defaultRpmLimit || model.rpmLimit),
    Number(item.payload.tpmLimit || model.tpmLimit),
    Number(item.payload.defaultTpmLimit || model.tpmLimit),
  )
}

function resourceConfig(resourceType: ResourceType) {
  return resourceTypeConfigs.value.find(item => item.resourceType === resourceType)
}

function isSelectedResourceType(resourceType: ResourceType) {
  return resourceApplicationForm.selectedResourceTypes.includes(resourceType)
}

function isResourceTypeAvailable(resourceType: ResourceType) {
  const config = resourceConfig(resourceType)
  return !!config && canApplyResourceType(config, currentUserLevelPriority.value)
}

function sanitizeSelectedResourceTypes() {
  const allowed = resourceApplicationForm.selectedResourceTypes.filter(isResourceTypeAvailable)
  resourceApplicationForm.selectedResourceTypes = allowed.length ? allowed : ['database']
  resourceApplicationItems.value = resourceApplicationItems.value.filter(item => isResourceTypeAvailable(item.resourceType))
  ensureSelectedResourceItems()
}

function toggleResourceType(resourceType: ResourceType) {
  if (!isResourceTypeAvailable(resourceType))
    return
  const shouldKeepTermsAccepted = hasAcceptedAllResourceTerms.value
  const exists = isSelectedResourceType(resourceType)
  if (exists && resourceApplicationForm.selectedResourceTypes.length === 1)
    return
  resourceApplicationForm.selectedResourceTypes = exists
    ? resourceApplicationForm.selectedResourceTypes.filter(item => item !== resourceType)
    : [...resourceApplicationForm.selectedResourceTypes, resourceType]
  ensureSelectedResourceItems()
  setRequiredResourceTermsAccepted(shouldKeepTermsAccepted)
}

function nextToMaterials() {
  sanitizeSelectedResourceTypes()
  setRequiredResourceTermsAccepted(hasAcceptedAllResourceTerms.value)
  currentStep.value = 'materials'
}

function nextToTerms() {
  ensureSelectedResourceItems()
  sanitizeResourceDurations()
  sanitizeLlmItems()
  currentStep.value = 'terms'
}

function hasAcceptedTerm(termId: ResourceTermId) {
  return resourceApplicationForm.acceptedTermIds.includes(termId)
}

function setRequiredResourceTermsAccepted(accepted: boolean) {
  resourceApplicationForm.acceptedTermIds = accepted ? [...requiredResourceTermIds.value] : []
}

function toggleRequiredResourceTerms() {
  setRequiredResourceTermsAccepted(!hasAcceptedAllResourceTerms.value)
}

function openTermsDialog() {
  activeResourceTermTab.value = selectedResourceTerms.value[0]?.id ?? ''
  isTermsDialogOpen.value = !!selectedResourceTerms.value.length
}

function closeTermsDialog() {
  isTermsDialogOpen.value = false
}

function selectResourceTermTab(termId: ResourceTermId) {
  activeResourceTermTab.value = termId
}

function setTermsDialogScrollLock(locked: boolean) {
  if (typeof document === 'undefined')
    return

  if (locked) {
    previousBodyOverflow = document.body.style.overflow
    previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return
  }

  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousHtmlOverflow
}

function cancelCreate() {
  router.push('/dashboard/apply')
}

function onSaveDraft() {
  runSafely(async () => {
    sanitizeResourceDurations()
    sanitizeLlmItems()
    await submitResourceApplication(true)
    clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '草稿已保存')
}

function onSubmitResourceApplication() {
  runSafely(async () => {
    sanitizeResourceDurations()
    sanitizeLlmItems()
    await submitResourceApplication(false)
    clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '资源申请已提交，等待各审批组逐项审批')
}

onMounted(() => {
  resetResourceApplicationForm()
  resetApplicationSecurity()
  restoreLocalDraft(applicationDraftKey, resourceApplicationForm)
  sanitizeDefaultFormChoices()
  sanitizeSelectedResourceTypes()
  sanitizeResourceDurations()
  sanitizeLlmItems()
  persistLocalDraft(applicationDraftKey, resourceApplicationForm)
})

onBeforeUnmount(() => {
  setTermsDialogScrollLock(false)
})
</script>

<template>
  <section class="resource-create-section space-y-6">
    <TxCard class="solid-panel" background="pure" shadow="soft" :padding="20" :radius="24">
      <div class="resource-create-header">
        <button class="resource-back-button" type="button" title="返回列表" @click="cancelCreate">
          <span class="i-carbon-chevron-left" />
        </button>
        <div class="min-w-0">
          <h2 class="resource-create-title">
            资源申请
          </h2>
        </div>
      </div>

      <div class="resource-step-track" aria-label="资源申请进度">
        <div
          v-for="(step, index) in resourceStepItems"
          :key="step.key"
          class="resource-step-item"
          :class="{ 'is-active': index === activeStep, 'is-complete': index < activeStep }"
        >
          <span class="resource-step-number">{{ index + 1 }}</span>
          <span class="resource-step-copy">
            <b>{{ step.title }}</b>
            <small>{{ step.description }}</small>
          </span>
        </div>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        请先登录后提交申请。
      </div>

      <div v-else class="mt-5 space-y-4">
        <template v-if="currentStep === 'types'">
          <div
            class="resource-consent-card"
            :class="{ 'is-accepted': hasAcceptedAllResourceTerms }"
            role="checkbox"
            tabindex="0"
            :aria-checked="hasAcceptedAllResourceTerms"
            @click="toggleRequiredResourceTerms"
            @keydown.enter.prevent="toggleRequiredResourceTerms"
            @keydown.space.prevent="toggleRequiredResourceTerms"
          >
            <DataNotice mode="compact" title="申请提交与免责确认" timing="before" />
            <span class="resource-consent-action">
              <TxCheckbox :model-value="hasAcceptedAllResourceTerms" variant="checkmark" />
              <span>
                <b>我已阅读并同意本申请所需协议</b>
                <small>当前资源类型将合并 {{ selectedResourceTerms.length }} 份协议。</small>
              </span>
              <TxButton class="resource-terms-open" size="sm" variant="secondary" @click.stop="openTermsDialog">
                展开协议
              </TxButton>
            </span>
          </div>

          <div class="gap-2 grid md:grid-cols-3 xl:grid-cols-4">
            <button
              v-for="config in visibleResourceTypeConfigs"
              :key="config.resourceType"
              type="button"
              class="p-2.5 text-left border rounded-2xl transition relative overflow-hidden"
              :class="isSelectedResourceType(config.resourceType) ? 'border-emerald-400 bg-emerald-50 shadow-md shadow-emerald-500/10 dark:bg-emerald-500/10' : 'border-black/8 bg-white hover:border-slate-400 dark:border-white/10 dark:bg-[#151820]'"
              @click="toggleResourceType(config.resourceType)"
            >
              <div class="flex gap-2 items-center justify-between">
                <span class="text-lg" :class="config.icon" />
                <span class="text-[10px] text-slate-500 fw-800">{{ config.approverGroup }}</span>
              </div>
              <div class="text-sm fw-900 mt-2">
                {{ config.displayName }}
              </div>
              <p class="text-xs text-slate-500 leading-4 mt-1 dark:text-slate-400">
                {{ config.description }}
              </p>
            </button>
          </div>

          <div class="flex flex-wrap gap-3 items-center justify-end">
            <span class="text-sm text-slate-500 dark:text-slate-400">已选 {{ resourceApplicationForm.selectedResourceTypes.length }} 类资源</span>
            <TxButton variant="primary" size="lg" @click="nextToMaterials">
              下一步：填写材料
            </TxButton>
          </div>
        </template>

        <template v-else-if="currentStep === 'materials'">
          <div class="gap-5 grid md:grid-cols-2">
            <label class="gap-2 grid md:col-span-2">
              <span class="field-label">申请标题</span>
              <TxInput v-model="resourceApplicationForm.title" placeholder="例如：客服 Agent 数据库 + 大模型 + GPU 申请" />
            </label>
            <label class="gap-2 grid md:col-span-2">
              <span class="field-label">申请说明</span>
              <RichTextEditor
                v-model="resourceApplicationForm.reason"
                :min-height="280"
                placeholder="请说明申请原因、业务背景、影响范围、公益/研发目标。可粘贴百度网盘等外链；图片建议作为下方附件上传。"
              />
            </label>
            <label class="gap-2 grid">
              <span class="field-label">紧急程度</span>
              <TxSelect v-model="resourceApplicationForm.urgency" panel-background="pure">
                <TxSelectItem v-for="item in urgencyOptions" :key="item.value" :value="item.value" :label="item.label" />
              </TxSelect>
            </label>
            <div class="gap-2 grid">
              <span class="field-label">期望生效时间</span>
              <TxSelect v-model="expectedEffectivePreset" panel-background="pure" @update:model-value="applyExpectedEffectivePreset">
                <TxSelectItem v-for="item in expectedEffectiveOptions" :key="item.value" :value="item.value" :label="item.label" />
              </TxSelect>
              <div v-if="expectedEffectivePreset === 'custom'" class="gap-2 grid grid-cols-[1fr_110px]">
                <TxInput :model-value="expectedDateValue" readonly placeholder="选择日期" @focus="openExpectedDatePicker" @click="openExpectedDatePicker" />
                <input v-model="expectedTimeValue" class="form-time-input" type="time">
              </div>
              <TxDatePicker v-model="expectedDateValue" v-model:visible="expectedDatePickerVisible" title="选择期望生效日期" confirm-text="确定" cancel-text="取消" />
            </div>
          </div>

          <div class="space-y-5">
            <div v-for="group in groupedResourceItems" :key="group.config!.resourceType" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-[#151820]">
              <div class="flex flex-wrap gap-3 items-center justify-between">
                <div>
                  <h3 class="text-xl fw-900">
                    {{ group.config!.displayName }}
                  </h3>
                  <p class="field-hint mt-1">
                    审批组：{{ group.config!.approverGroup }}
                  </p>
                </div>
                <TxButton size="sm" variant="secondary" @click="addResourceApplicationItem(group.config!.resourceType)">
                  添加明细
                </TxButton>
              </div>

              <div class="mt-4 space-y-4">
                <div v-for="item in group.items" :key="item.id" class="p-4 rounded-2xl bg-slate-50 dark:bg-white/5">
                  <div class="flex flex-wrap gap-3 items-center justify-between">
                    <b>资源明细</b>
                    <TxButton size="sm" variant="danger" @click="removeResourceApplicationItem(item.id)">
                      删除
                    </TxButton>
                  </div>

                  <div class="mt-4 gap-4 grid md:grid-cols-2">
                    <label v-if="item.resourceType !== 'llm_api_quota'" class="gap-2 grid">
                      <span class="field-label">子类型</span>
                      <TxSelect v-model="item.resourceSubtype" panel-background="pure">
                        <TxSelectItem v-for="subtype in group.config!.subtypes" :key="subtype" :value="subtype" :label="subtype" />
                      </TxSelect>
                    </label>

                    <template v-if="item.resourceType === 'database'">
                      <label class="gap-2 grid"><span class="field-label">实例/库名</span><TxInput v-model="item.payload.name" placeholder="orders_prod / cache_user" /></label>
                      <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">权限级别</span><TxSelect v-model="item.requestedPermission" panel-background="pure"><TxSelectItem v-for="option in databasePermissionOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                      <label class="option-check md:col-span-2"><TxCheckbox v-model="item.payload.sensitiveData" variant="checkmark" /><span><b>涉及敏感数据</b><small>生产库、用户信息或受限数据需勾选。</small></span></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">申请原因</span><RichTextEditor v-model="item.payload.reason" :min-height="120" placeholder="说明申请原因" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">操作范围说明</span><RichTextEditor v-model="item.payload.operationScope" :min-height="120" placeholder="读取哪些表、执行哪些操作、是否需要变更数据" /></label>
                    </template>

                    <template v-else-if="item.resourceType === 'llm_api_quota'">
                      <label class="gap-2 grid"><span class="field-label">大模型</span><TxSelect v-model="item.payload.model" panel-background="pure" @update:model-value="onLlmModelChange(item)"><TxSelectItem v-for="model in selectableLlmApiModels" :key="model.key" :value="model.key" :label="`${model.name} · 倍率 ×${LLM_API_MODEL_COST_MULTIPLIERS[model.key as keyof typeof LLM_API_MODEL_COST_MULTIPLIERS] ?? 1}`" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                      <div class="gap-2 grid">
                        <span class="field-label">RPM / TPM 策略</span>
                        <TxSelect v-model="item.payload.rateLimitMode" panel-background="pure" @update:model-value="onRateLimitModeChange(item)">
                          <TxSelectItem v-for="option in rateLimitModeOptions" :key="option.value" :value="option.value" :label="option.label" />
                        </TxSelect>
                      </div>
                      <div v-if="item.payload.rateLimitMode === 'custom'" class="gap-4 grid md:col-span-2 md:grid-cols-2">
                        <label class="gap-2 grid">
                          <span class="field-label">RPM</span>
                          <TxNumberInput v-model="item.payload.rpmLimit" :min="1" :max="1000" :step="1" :controls="false" />
                        </label>
                        <label class="gap-2 grid">
                          <span class="field-label">TPM</span>
                          <TxNumberInput v-model="item.payload.tpmLimit" :min="1" :max="10000000" :step="1000" :controls="false" />
                        </label>
                      </div>
                      <div class="gap-2 grid md:col-span-2">
                        <span class="field-label">默认 RPM / TPM</span>
                        <div class="rate-default-card">
                          默认 RPM {{ llmModelForItem(item)?.rpmLimit ?? '-' }} · 默认 TPM {{ llmModelForItem(item)?.tpmLimit ?? '-' }}
                        </div>
                      </div>
                      <div v-if="llmRateChangeCost(item)" class="rate-warning md:col-span-2">
                        <b>修改 RPM / TPM 会消耗大量积分：约 {{ llmRateChangeCost(item).toLocaleString('zh-CN') }} 积分</b><span>该消耗不享受任何折扣；请谨慎调整，费用很高很高。最终实际扣费以后端结算为准。</span>
                      </div>
                      <div class="gap-3 grid md:col-span-2">
                        <div class="flex flex-wrap gap-3 items-center justify-between">
                          <span class="field-label">Token 额度</span><b>{{ formatUsd(item.payload.budgetLimit) }}</b>
                        </div><TxSlider v-model="item.payload.budgetLimit" :min="10" :max="1000" :step="10" :show-value="false" :format-value="formatUsd" /><div class="quota-marks">
                          <span v-for="mark in llmBudgetMarks" :key="mark">{{ formatUsd(mark) }}</span>
                        </div><p v-if="item.payload.budgetLimit > 100" class="field-hint text-amber-600 dark:text-amber-300">
                          超过 $100 的额度申请需要更长时间审核
                        </p>
                      </div>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">使用场景</span><RichTextEditor v-model="item.payload.usageScenario" :min-height="140" placeholder="说明项目用途、调用场景、预估消耗和收益" /></label>
                    </template>

                    <template v-else>
                      <label class="gap-2 grid"><span class="field-label">规格</span><TxInput v-model="item.payload.specification" placeholder="规格、权限级别、容量或配额" /></label>
                      <label class="gap-2 grid"><span class="field-label">数量</span><TxNumberInput v-model="item.payload.quantity" :min="1" :step="1" :controls="false" /></label>
                      <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                      <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                      <label class="gap-2 grid"><span class="field-label">项目</span><TxInput v-model="item.payload.project" /></label>
                      <label class="gap-2 grid"><span class="field-label">成本归属</span><TxInput v-model="item.payload.costCenter" /></label>
                      <label class="gap-2 grid md:col-span-2"><span class="field-label">访问范围或用途说明</span><RichTextEditor v-model="item.payload.purpose" :min-height="120" placeholder="说明访问范围、用途和必要性" /></label>
                    </template>
                  </div>
                  <div class="resource-estimate-card mt-4">
                    <div class="flex flex-wrap gap-2 items-center justify-between">
                      <b>本项预估资源</b>
                      <span>{{ formatPoints(itemEstimateParts(item).discounted) }}</span>
                    </div>
                    <ul class="resource-estimate-list">
                      <li>
                        <span>基础</span>
                        <b>{{ formatPoints(itemEstimateParts(item).base) }}</b>
                      </li>
                      <li v-if="itemEstimateParts(item).rate">
                        <span>RPM/TPM</span>
                        <b>{{ formatPoints(itemEstimateParts(item).rate) }}</b>
                      </li>
                      <li v-if="itemEstimateParts(item).duration">
                        <span>有效期延长</span>
                        <b>{{ formatPoints(itemEstimateParts(item).duration) }}</b>
                      </li>
                      <li v-if="itemEstimateParts(item).savings" class="is-saving">
                        <span>{{ itemActivityDiscountText(item) }}</span>
                        <b>-{{ formatPoints(itemEstimateParts(item).savings) }}</b>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="mb-2 flex gap-3 items-center justify-between">
              <span class="field-label">Markdown 附件 / 图片</span>
              <span class="field-hint">{{ formatBytes(totalApplicationBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
            </div>
            <TxFileUploader v-model="applicationFiles" :max="20" button-text="上传附件" drop-text="图片和补充材料都拖拽到这里" hint-text="图片、Markdown 附件和补充材料都上传到这里；全部文件总大小不超过 200MB。也可在申请说明里填写百度网盘等外链。" />
          </div>

          <div class="flex flex-wrap gap-3 justify-between">
            <TxButton variant="secondary" @click="onSaveDraft">
              保存草稿
            </TxButton>
            <div class="flex gap-3">
              <TxButton variant="ghost" @click="currentStep = 'types'">
                上一步
              </TxButton>
              <TxButton variant="primary" @click="nextToTerms">
                下一步：结算单
              </TxButton>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-if="(resourceApplicationPolicyStatus.turnstileEnabled && resourceApplicationPolicyStatus.turnstileSiteKey) || applicationSecurityForm.message" class="resource-confirm-card resource-security-card">
            <TurnstileChallenge
              v-if="resourceApplicationPolicyStatus.turnstileEnabled && resourceApplicationPolicyStatus.turnstileSiteKey"
              :site-key="resourceApplicationPolicyStatus.turnstileSiteKey"
              @verified="setApplicationTurnstileToken"
              @expired="setApplicationTurnstileToken('')"
            />
            <p v-if="applicationSecurityForm.message" class="field-hint">
              {{ applicationSecurityForm.message }}
            </p>
          </div>

          <div class="resource-confirm-card resource-checkout-card">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <h3 class="text-lg fw-900">
                  资源明细
                </h3>
                <p class="field-hint mt-1">
                  大模型额度按申请金额阶梯折扣；RPM/TPM 修改和有效期延长不参与活动折扣。
                </p>
              </div>
              <span class="text-xs fw-900 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10">
                {{ resourceCheckoutRows.length }} 条
              </span>
            </div>
            <div class="checkout-table mt-3">
              <div class="checkout-table-row checkout-table-head">
                <span>资源</span>
                <span>有效期</span>
                <span>基础成本</span>
                <span>额外成本</span>
                <span>活动后</span>
              </div>
              <div v-for="row in resourceCheckoutRows" :key="row.id" class="checkout-table-row">
                <div class="checkout-resource-cell min-w-0">
                  <b>{{ row.type }}</b>
                  <span>{{ row.subtype }}</span>
                  <small>{{ row.details.join(' · ') }}</small>
                </div>
                <span>{{ row.duration }}</span>
                <span>{{ formatPoints(row.base) }}</span>
                <span>{{ formatPoints(row.rate + row.durationCost) }}</span>
                <b>{{ formatPoints(row.discounted) }}</b>
              </div>
            </div>
          </div>

          <div class="order-total-panel">
            <div class="flex flex-wrap gap-3 items-start justify-between">
              <div>
                <div class="order-total-title">
                  订单结算
                </div>
                <div class="order-total-summary">
                  {{ resourceApplicationForm.title }} · 资源申请 · {{ resourceApplicationItems.length }} 条资源明细
                </div>
              </div>
              <label class="order-coupon-select">
                <span>优惠券</span>
                <TxSelect v-model="resourceApplicationForm.selectedCouponId" panel-background="pure">
                  <TxSelectItem value="" label="不使用优惠券" />
                  <TxSelectItem v-for="coupon in availableCurrentUserCoupons" :key="coupon.id" :value="coupon.id" :label="`${coupon.name} · ${couponDiscountText(coupon.discountRate)}`" />
                </TxSelect>
              </label>
            </div>
            <label class="square-share-option mt-3">
              <TxCheckbox v-model="resourceApplicationForm.shareToSquare" variant="checkmark" />
              <span>
                <b>发布到广场参与拼一刀</b>
                <small>提交后公开申请标题、说明和资源明细，用于邀请他人支持这个领域；本单在优惠券后继续享受 {{ rateDiscountText(SQUARE_SHARE_DISCOUNT_RATE) }}，可与其他优惠叠加。广场助力每 3 人递减 0.1 折，最低 8 折。</small>
              </span>
            </label>
            <label v-if="resourceApplicationForm.shareToSquare" class="mt-3 gap-2 grid">
              <span class="field-label">广场展示说明</span>
              <RichTextEditor
                v-model="resourceApplicationForm.squarePostContent"
                :min-height="120"
                placeholder="说明为什么这个领域值得支持，或补充项目背景。留空时使用申请说明。"
              />
            </label>
            <div class="order-total-table mt-3">
              <div>
                <span>累计预估积分消耗</span>
                <b>{{ formatPoints(totalUndiscountedEstimate) }}</b>
              </div>
              <div class="is-discount">
                <span class="order-total-label">
                  <i class="order-benefit-tag">限时福利</i>
                  {{ ACTIVITY_NAME }} 后价格
                </span>
                <b>{{ formatPoints(totalDiscountedEstimate) }}</b>
              </div>
              <div class="is-discount">
                <span>优惠券抵扣</span>
                <b>-{{ formatPoints(couponDiscountAmount) }}</b>
              </div>
              <div class="is-discount">
                <span>广场发布折扣</span>
                <b>-{{ formatPoints(squareDiscountAmount) }}</b>
              </div>
              <div class="is-saving">
                <span>共节省</span>
                <b>{{ formatPoints(totalDiscountSavings) }}</b>
              </div>
              <div class="is-total">
                <span>本单预扣</span>
                <b>{{ formatPoints(checkoutPayableEstimate) }}</b>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-3 justify-between">
            <TxButton variant="secondary" @click="onSaveDraft">
              保存草稿
            </TxButton>
            <div class="flex gap-3">
              <TxButton variant="ghost" @click="currentStep = 'materials'">
                上一步
              </TxButton>
              <TxButton variant="primary" :disabled="isResourceSubmissionBlocked" @click="onSubmitResourceApplication">
                提交并预扣 {{ formatPoints(checkoutPayableEstimate) }}
              </TxButton>
            </div>
          </div>
          <p class="field-hint text-right">
            当前待处理请求：{{ activeRequestCount }}/{{ MAX_ACTIVE_USER_REQUESTS }}
          </p>
        </template>
      </div>
    </TxCard>

    <div v-if="isTermsDialogOpen" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeTermsDialog">
      <div class="dialog-surface resource-terms-dialog solid-panel p-6 rounded-3xl max-h-[calc(100vh-3rem)] max-w-4xl w-full overflow-auto">
        <div class="flex gap-4 items-start justify-between">
          <div>
            <h3 class="text-2xl fw-900 tracking-tight">
              协议详情
            </h3>
            <p class="field-hint mt-2">
              本申请会按当前资源类型合并以下协议；提交时记录协议 ID、版本、同意人和时间。
            </p>
          </div>
          <button class="icon-btn shrink-0" title="关闭" @click="closeTermsDialog">
            <span class="i-carbon-close" />
          </button>
        </div>

        <div class="resource-terms-warning mt-5">
          <b>免责与封禁规则</b>
          <p>
            若申请人违反资源、数据、大模型或基础设施使用政策，平台可直接封禁账号、回收资源、暂停关联申请和临时凭据；违规导致的预扣积分、已消费积分、审核费用和活动优惠均不退还。管理员后台可基于申请记录、日志、举报和审计结果执行封禁或解封。
          </p>
        </div>

        <div v-if="selectedResourceTerms.length" class="resource-term-tabs mt-5">
          <div class="resource-term-tab-list" role="tablist" aria-label="协议详情">
            <button
              v-for="term in selectedResourceTerms"
              :key="term.id"
              type="button"
              class="resource-term-tab"
              :class="{ 'is-active': activeResourceTerm?.id === term.id }"
              role="tab"
              :aria-selected="activeResourceTerm?.id === term.id"
              @click="selectResourceTermTab(term.id)"
            >
              {{ term.title }}
            </button>
          </div>

          <div v-if="activeResourceTerm" class="resource-term-detail" role="tabpanel">
            <div class="resource-term-detail-head">
              <div>
                <h4>{{ activeResourceTerm.title }}</h4>
                <p>协议 ID：{{ activeResourceTerm.id }} · 版本：v{{ activeResourceTerm.version }}</p>
              </div>
              <span :class="hasAcceptedTerm(activeResourceTerm.id) ? 'is-accepted' : ''">
                {{ hasAcceptedTerm(activeResourceTerm.id) ? '已同意' : '待同意' }}
              </span>
            </div>
            <ol class="resource-term-detail-list">
              <li v-for="(item, index) in resourceTermDetailMap[activeResourceTerm.id]" :key="`${activeResourceTerm.id}-${index}`">
                {{ item }}
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
