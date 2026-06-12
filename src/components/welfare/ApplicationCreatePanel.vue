<script setup lang="ts">
import type { RequestKind, ResourcePoolCategoryId, ResourcePoolItemConfig, ResourceTermId, ResourceType } from '~/composables/welfare'
import { TxButton, TxCheckbox, TxDatePicker, TxFileUploader, TxInput, TxNumberInput, TxSelect, TxSelectItem, TxSlider } from '@talex-touch/tuffex'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWelfareFeedback } from '~/composables/feedback'
import { clearLocalDraft, persistLocalDraft, restoreLocalDraft } from '~/composables/local-draft'
import { ACTIVITY_NAME, calculateActivityPrice, calculateLlmApiBudgetActivityPrice, calculateLlmApiCostPoints, calculateLlmApiRateLimitChangeCost, calculateRejectionReviewFee, canApplyResourceType, defaultLlmApiDuration, formatBytes, formatDate, GPT_PRO_ACTIVITY_NAME, GPT_PRO_DEFAULT_DURATION, GPT_PRO_DEFAULT_ROUNDS, GPT_PRO_MAX_ROUNDS, GPT_PRO_MIN_ROUNDS, isGptProModel, LLM_API_MODEL_COST_MULTIPLIERS, llmApiBudgetActivityDiscountRate, llmApiDurationExtensionCost, MAX_ACTIVE_USER_REQUESTS, MAX_ATTACHMENT_BYTES, REJECTION_FEE_WAIVER_BLOCK_DAYS, REJECTION_FRAUD_COOLDOWN_DAYS, REJECTION_REVIEW_FEE_MAX, REJECTION_REVIEW_FEE_MIN, REJECTION_REVIEW_FEE_RATE, RESOURCE_DEFAULT_DURATION, RESOURCE_DURATION_EXTENSION_COST, RESOURCE_POOL_CATEGORIES, RESOURCE_TERMS, SQUARE_SHARE_DISCOUNT_RATE } from '~/composables/welfare'
import { useWelfareUiState } from '~/composables/welfare-ui'
import DataNotice from './DataNotice.vue'
import RichTextEditor from './RichTextEditor.vue'
import TurnstileChallenge from './TurnstileChallenge.vue'

const {
  state,
  currentUser,
  hasCurrentUserPointBalance,
  applicationForm,
  applicationSecurityForm,
  applicationFiles,
  resourceApplicationForm,
  resourceApplicationItems,
  resourceTypeConfigs,
  selectedResourceTerms,
  selectedApplicationPolicyStatus,
  resourceApplicationPolicyStatus,
  selectedPrepaidCost,
  availableResourceCoupons,
  totalApplicationBytes,
  activeRequestCount,
  canCreateRequest,
  selectableLlmApiModels,
  currentUserRejectionFeeWaiverBlockedUntil,
  userLevelCard,
  submitResourceApplication,
  addResourceApplicationItem,
  removeResourceApplicationItem,
  ensureSelectedResourceItems,
  resetResourceApplicationForm,
  fillResourceApplicationFormFromDraft,
  resetApplicationFiles,
  resetApplicationSecurity,
  setApplicationTurnstileToken,
  submitApplicationWithAiReview,
  updateResourceDraft,
} = useWelfareUiState()

const route = useRoute()
const router = useRouter()
const { notify, runSafely } = useWelfareFeedback()
type ApplicationCreateMode = Extract<RequestKind, 'image' | 'pro' | 'resource'>
const applicationMode = ref<ApplicationCreateMode>('resource')
const expectedDatePickerVisible = ref(false)
const isTermsDialogOpen = ref(false)
const isRejectionFeeDetailsOpen = ref(false)
const activeResourceTermTab = ref<ResourceTermId | ''>('')
const submitReadyMessage = ref('')
const resourcePoolSearch = ref('')
const expandedResourcePoolCategoryIds = ref<ResourcePoolCategoryId[]>([])
const expectedEffectivePreset = ref('after_approval')
const applicationDraftKey = 'welfare:resource-application-draft'
let previousBodyOverflow = ''
let previousHtmlOverflow = ''
let stopPersistLocalDraft: (() => void) | undefined

const draftApplicationId = computed(() => {
  const raw = route.query.draft
  return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')
})
const editingDraftApplication = computed(() => {
  if (!draftApplicationId.value)
    return undefined

  return state.applications.find(item =>
    item.id === draftApplicationId.value
    && item.type === 'resource'
    && item.status === 'draft'
    && item.userId === currentUser.value?.id,
  )
})
const isEditingDraft = computed(() => !!editingDraftApplication.value)
const currentUserLevelPriority = computed(() => currentUser.value ? userLevelCard(currentUser.value.id).priority : 0)
const applicationModeItems: Array<{ type: ApplicationCreateMode, label: string, title: string, description: string, icon: string }> = [
  { type: 'image', label: 'Image', title: 'Image 图片资源', description: '用于素材图、海报生成', icon: 'i-carbon-image' },
  { type: 'pro', label: 'Pro', title: 'Pro 高级权益', description: '用于高级协作与高级能力', icon: 'i-carbon-star' },
  { type: 'resource', label: '资源', title: '资源 API / 配额资源', description: '用于模型调用、接口配置、批量任务', icon: 'i-carbon-data-base' },
]
const currentModeTitle = computed(() => applicationModeItems.find(item => item.type === applicationMode.value)?.label ?? '资源')
const currentCreateTitle = computed(() => {
  if (isEditingDraft.value)
    return '编辑资源草稿'

  return applicationMode.value === 'resource' ? '资源申请' : `${currentModeTitle.value} 申请`
})
const currentModeBadge = computed(() => applicationMode.value === 'resource' ? '公益资源支持' : applicationMode.value === 'image' ? '图片资源' : '高级权益')
const currentModeTagline = computed(() => {
  if (applicationMode.value === 'resource')
    return ''
  if (applicationMode.value === 'image')
    return '提交图片生成需求，补充用途、风格、尺寸与限制说明。'
  return '提交 Pro 能力申请，说明协作场景、目标产出和时效要求。'
})
const activeResourceTerm = computed(() =>
  selectedResourceTerms.value.find(term => term.id === activeResourceTermTab.value)
  ?? selectedResourceTerms.value[0],
)
const rejectionFeeWaiverBlockedUntil = computed(() => currentUserRejectionFeeWaiverBlockedUntil.value)
const isRejectionFeeWaiverBlocked = computed(() => !!rejectionFeeWaiverBlockedUntil.value)
const rejectionFeeWaiverBlockedUntilText = computed(() => rejectionFeeWaiverBlockedUntil.value ? formatDate(rejectionFeeWaiverBlockedUntil.value) : '')
const rejectionFeeRateText = computed(() => `${Math.round(REJECTION_REVIEW_FEE_RATE * 100)}%`)
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
  creative_service_terms: [
    '素材授权：申请人必须确认提交的文案、图片、视频、肖像、商标、数据和参考资料具备合法使用权，且不包含未授权隐私、商业机密或第三方受限内容。',
    '用途边界：简历、申请材料、PPT、翻译、发布协助、图片视频和运营素材仅按申请单写明场景交付，不承诺录取、转化、曝光、审核通过或收益结果。',
    '公开发布：涉及公开渠道发布时，申请人应说明平台、账号、受众、版权归属、署名要求、下架联系人和风险限制，并自行承担第三方平台政策责任。',
    '合规责任：因素材侵权、虚假包装、违规宣传、诱导营销、隐私泄露或违反第三方平台政策导致投诉、下架、封禁或法律风险的，平台可拒绝交付且不退还已消耗积分。',
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
const normalizedResourcePoolSearch = computed(() => resourcePoolSearch.value.trim().toLowerCase())
const selectedResourcePoolItemIds = computed(() => new Set(resourceApplicationItems.value.map(item => `${item.resourceType}:${item.resourceSubtype}`)))
function defaultExpandedResourcePoolCategoryIds() {
  return RESOURCE_POOL_CATEGORIES
    .filter(category => category.items.some((item) => {
      const config = resourceTypeConfigs.value.find(candidate => candidate.resourceType === item.resourceType)
      return config?.availability === 'available'
    }))
    .map(category => category.id)
}

const resourcePoolCategories = computed(() => RESOURCE_POOL_CATEGORIES.map((category) => {
  const items = category.items
    .map((item) => {
      const config = resourceTypeConfigs.value.find(candidate => candidate.resourceType === item.resourceType)
      const matchesSearch = !normalizedResourcePoolSearch.value
        || item.label.toLowerCase().includes(normalizedResourcePoolSearch.value)
        || item.description.toLowerCase().includes(normalizedResourcePoolSearch.value)
        || item.info?.toLowerCase().includes(normalizedResourcePoolSearch.value)
        || category.label.toLowerCase().includes(normalizedResourcePoolSearch.value)
      return {
        ...item,
        config,
        matchesSearch,
        selected: selectedResourcePoolItemIds.value.has(item.id),
        available: !!config && canApplyResourceType(config, currentUserLevelPriority.value),
      }
    })
    .filter(item => item.config && item.matchesSearch)

  return {
    ...category,
    items,
    selectedCount: items.filter(item => selectedResourcePoolItemIds.value.has(item.id)).length,
    totalCount: items.length,
  }
}).filter(category => category.items.length))

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
const gptProRoundMarks = [1, 5, 10, 25, 50]
const durationOptions = [
  { value: RESOURCE_DEFAULT_DURATION, label: RESOURCE_DEFAULT_DURATION },
  { value: '7 天', label: '延长至 7 天' },
  { value: '30 天', label: '延长至 30 天' },
]

function formatUsd(value: number) {
  return `$${Number(value || 0).toLocaleString('en-US')}`
}

function formatRounds(value: number) {
  return `${Math.trunc(Number(value || 0)).toLocaleString('zh-CN')} 轮`
}

function resourceItemAttachmentBytes(item: { payload: Record<string, any> }) {
  const attachments = Array.isArray(item.payload.attachments) ? item.payload.attachments : []
  return attachments.reduce((sum, file) => sum + Math.max(0, Math.trunc(Number(file?.size || 0))), 0)
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

function isGptProItem(item: { payload: Record<string, any> }) {
  return isGptProModel(llmModelForItem(item))
}

function formatLlmQuota(value: number, model = selectableLlmApiModels.value[0]) {
  return isGptProModel(model) ? formatRounds(value) : formatUsd(value)
}

function formatLlmQuotaForItem(item: { payload: Record<string, any> }) {
  return formatLlmQuota(Number(item.payload.budgetLimit || llmModelForItem(item)?.defaultBudgetUsd || 0), llmModelForItem(item))
}

function llmQuotaFormatter(item: { payload: Record<string, any> }) {
  const model = llmModelForItem(item)
  return (value: number) => formatLlmQuota(value, model)
}

function llmQuotaFieldLabel(item: { payload: Record<string, any> }) {
  return isGptProItem(item) ? '对话轮次' : 'Token 额度'
}

function llmQuotaMarks(item: { payload: Record<string, any> }) {
  return isGptProItem(item) ? gptProRoundMarks : llmBudgetMarks
}

function llmQuotaMin(item: { payload: Record<string, any> }) {
  const model = llmModelForItem(item)
  return isGptProModel(model) ? GPT_PRO_MIN_ROUNDS : model?.minBudgetUsd ?? 10
}

function llmQuotaMax(item: { payload: Record<string, any> }) {
  const model = llmModelForItem(item)
  return isGptProModel(model) ? GPT_PRO_MAX_ROUNDS : model?.maxBudgetUsd ?? 1000
}

function llmQuotaStep(item: { payload: Record<string, any> }) {
  return isGptProItem(item) ? 1 : 10
}

function requestedQuotaText(item: { payload: Record<string, any> }) {
  const model = llmModelForItem(item)
  const value = Number(item.payload.budgetLimit || model?.defaultBudgetUsd || 0)
  return isGptProModel(model) ? `${formatRounds(value)}对话` : formatUsd(value)
}

function durationOptionsForItem(item: { payload: Record<string, any> }) {
  if (!isGptProItem(item))
    return durationOptions

  return [
    { value: GPT_PRO_DEFAULT_DURATION, label: '默认 7 天' },
    { value: '30 天', label: '延长至 30 天' },
  ]
}

function llmModelSelectLabel(model: { key: string, name: string }) {
  return isGptProModel(model)
    ? `${model.name} · 默认 ${GPT_PRO_DEFAULT_ROUNDS} 轮 / ${GPT_PRO_DEFAULT_DURATION}`
    : `${model.name} · 倍率 ×${LLM_API_MODEL_COST_MULTIPLIERS[model.key as keyof typeof LLM_API_MODEL_COST_MULTIPLIERS] ?? 1}`
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
  item.payload.duration = item.payload.duration || defaultLlmApiDuration(model)
  if (isGptProModel(model) && item.payload.duration === RESOURCE_DEFAULT_DURATION)
    item.payload.duration = defaultLlmApiDuration(model)
  item.requestedQuota = requestedQuotaText(item)
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
  item.payload.duration = defaultLlmApiDuration(model)
  item.requestedQuota = requestedQuotaText(item)
  item.duration = item.payload.duration
}

function sanitizeResourceDurations() {
  for (const item of resourceApplicationItems.value) {
    const model = item.resourceType === 'llm_api_quota' ? llmModelForItem(item) : undefined
    const defaultDuration = model ? defaultLlmApiDuration(model) : RESOURCE_DEFAULT_DURATION
    const duration = item.duration || item.payload.duration || defaultDuration
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
  const model = item.payload.model ? llmModelForItem(item) : undefined
  if (model)
    return llmApiDurationExtensionCost(item.duration || item.payload.duration, model)

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
  const model = item.resourceType === 'llm_api_quota' ? llmModelForItem(item) : undefined
  return item.resourceType === 'llm_api_quota'
    ? calculateLlmApiBudgetActivityPrice(itemBaseEstimate(item), Number(item.payload.budgetLimit || model?.defaultBudgetUsd || 10), model) + llmRateChangeCost(item) + itemDurationExtensionCost(item)
    : calculateActivityPrice(itemBaseEstimate(item)) + llmRateChangeCost(item) + itemDurationExtensionCost(item)
}

const totalUndiscountedEstimate = computed(() => resourceApplicationItems.value.reduce((sum, item) => sum + itemUndiscountedEstimate(item), 0))
const totalDiscountedEstimate = computed(() => resourceApplicationItems.value.reduce((sum, item) => sum + itemDiscountedEstimate(item), 0))
const activityDiscountAmount = computed(() => Math.max(0, totalUndiscountedEstimate.value - totalDiscountedEstimate.value))
const hasActivityDiscount = computed(() => activityDiscountAmount.value > 0)
const selectedResourceCoupon = computed(() => availableResourceCoupons.value.find(coupon => coupon.id === resourceApplicationForm.selectedCouponId))
const couponDiscountAmount = computed(() => {
  if (!selectedResourceCoupon.value)
    return 0

  if (selectedResourceCoupon.value.discountType === 'fixed_points')
    return Math.min(totalDiscountedEstimate.value, selectedResourceCoupon.value.discountAmount ?? 0)

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
const checkoutActivityNames = computed(() => {
  const names = new Set<string>()
  if (resourceApplicationItems.value.some(item => item.resourceType === 'llm_api_quota' && isGptProItem(item)))
    names.add(GPT_PRO_ACTIVITY_NAME)
  if (resourceApplicationItems.value.some(item => itemEstimateParts(item).savings > 0 && !(item.resourceType === 'llm_api_quota' && isGptProItem(item))))
    names.add(ACTIVITY_NAME)
  return Array.from(names)
})
const checkoutActivityLabel = computed(() => checkoutActivityNames.value.join(' / ') || ACTIVITY_NAME)
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
const isClassicApplication = computed(() => applicationMode.value !== 'resource')
const currentRejectionFeeBaseCost = computed(() => isClassicApplication.value ? selectedPrepaidCost.value : checkoutPayableEstimate.value)
const currentEstimatedRejectionReviewFee = computed(() => calculateRejectionReviewFee(currentRejectionFeeBaseCost.value))
const currentRejectionFeeScenario = computed(() => applicationMode.value === 'resource' ? '本单资源申请' : `${currentModeTitle.value} 申请`)

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

watch(availableResourceCoupons, () => {
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
watch(normalizedResourcePoolSearch, (value) => {
  if (value)
    expandedResourcePoolCategoryIds.value = resourcePoolCategories.value.map(category => category.id)
})
watch(() => isTermsDialogOpen.value || isRejectionFeeDetailsOpen.value, setTermsDialogScrollLock)

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

function couponDiscountText(coupon: { discountType?: string, discountRate: number, discountAmount?: number }) {
  if (coupon.discountType === 'fixed_points')
    return `抵扣 ${coupon.discountAmount ?? 0} 积分`
  if (coupon.discountType === 'fixed_ldc')
    return `抵扣 ${coupon.discountAmount ?? 0} LDC`
  return `${Number(coupon.discountRate * 10).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 折`
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
      `${isGptProModel(model) ? '对话' : '额度'} ${formatLlmQuotaForItem(item)}`,
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

function isSelectedResourcePoolItem(item: ResourcePoolItemConfig) {
  return selectedResourcePoolItemIds.value.has(item.id)
}

function isResourceTypeAvailable(resourceType: ResourceType) {
  const config = resourceConfig(resourceType)
  return !!config && canApplyResourceType(config, currentUserLevelPriority.value)
}

function sanitizeSelectedResourceTypes() {
  const allowed = resourceApplicationForm.selectedResourceTypes.filter(isResourceTypeAvailable)
  resourceApplicationForm.selectedResourceTypes = allowed
  resourceApplicationItems.value = resourceApplicationItems.value.filter(item => isResourceTypeAvailable(item.resourceType))
  ensureSelectedResourceItems()
}

function isResourcePoolCategoryExpanded(categoryId: ResourcePoolCategoryId) {
  return expandedResourcePoolCategoryIds.value.includes(categoryId)
}

function toggleResourcePoolCategory(categoryId: ResourcePoolCategoryId) {
  expandedResourcePoolCategoryIds.value = isResourcePoolCategoryExpanded(categoryId)
    ? expandedResourcePoolCategoryIds.value.filter(item => item !== categoryId)
    : [...expandedResourcePoolCategoryIds.value, categoryId]
}

function resourcePoolItemDisabledReason(item: ResourcePoolItemConfig) {
  const config = resourceConfig(item.resourceType)
  if (!config)
    return '资源类型未配置'
  if (config.availability === 'unavailable')
    return config.unavailableReason || '暂时不提供申请'
  if (config.availability === 'level_required' && currentUserLevelPriority.value < (config.minUserLevelPriority ?? 0))
    return config.unavailableReason || `平台等级 Lv${config.minUserLevelPriority} 开放`
  return ''
}

function resourcePoolItemTooltip(item: ResourcePoolItemConfig) {
  const config = resourceConfig(item.resourceType)
  const disabledReason = resourcePoolItemDisabledReason(item)
  const termTitles = (config?.termsIds ?? [])
    .map(termId => RESOURCE_TERMS.find(term => term.id === termId)?.title)
    .filter((title): title is string => !!title)
  const status = disabledReason ? `当前限制：${disabledReason}` : '当前限制：可申请，提交后按申请明细和审核结果发放。'
  const lines = [
    item.description,
    item.info ? `支持/适用：${item.info.replace(/^支持：|^适用：/, '')}` : '',
    config ? `审批组：${config.approverGroup}` : '',
    status,
    termTitles.length ? `协议限制：需同意通用资源使用条款、${termTitles.join('、')}。` : '协议限制：需同意通用资源使用条款。',
    item.resourceType === 'llm_api_quota' ? '合规限制：不得上传未脱敏隐私、密钥、商业机密或受限代码；额度不得共享、倒卖或用于未说明场景。' : '',
    item.resourceType === 'database' ? '数据限制：遵循最小权限，不导出、不长期保存未授权数据；生产和敏感数据需说明操作范围。' : '',
    ['content_service', 'media_publishing', 'data_productivity', 'quality_review'].includes(item.resourceType) ? '内容限制：不得提交虚假经历、侵权素材、未授权肖像、密钥、隐私数据或违反第三方平台政策的内容；公开发布需确认版权和下架联系人。' : '',
    ['server', 'gpu', 'k8s_namespace', 'object_storage', 'git_repository', 'cicd', 'vpn', 'ip_allowlist', 'notification_channel', 'identity_security'].includes(item.resourceType) ? '基础设施限制：不得挖矿、转租、公开代理、攻击第三方或绕过访问控制；到期需释放资源。' : '',
  ].filter(Boolean)
  return lines.join('\n')
}

function genericResourceSpecificationLabel(resourceType: ResourceType) {
  if (resourceType === 'content_service')
    return '交付形式'
  if (resourceType === 'media_publishing')
    return '发布形式'
  if (resourceType === 'data_productivity')
    return '数据范围'
  if (resourceType === 'quality_review')
    return '审查范围'
  return '规格'
}

function genericResourceSpecificationPlaceholder(resourceType: ResourceType) {
  if (resourceType === 'content_service')
    return '简历、PPT、文档页数、语言或目标岗位'
  if (resourceType === 'media_publishing')
    return '图片数量、尺寸、平台、格式或发布渠道'
  if (resourceType === 'data_productivity')
    return '数据源、指标、报表范围或自动化目标'
  if (resourceType === 'quality_review')
    return '页面、流程、浏览器矩阵或检查清单'
  return '规格、权限级别、容量或配额'
}

function genericResourcePurposeLabel(resourceType: ResourceType) {
  if (['content_service', 'media_publishing'].includes(resourceType))
    return '需求与素材说明'
  if (['data_productivity', 'quality_review'].includes(resourceType))
    return '目标与验收说明'
  return '访问范围或用途说明'
}

function genericResourcePurposePlaceholder(resourceType: ResourceType) {
  if (resourceType === 'content_service')
    return '说明目标受众、素材来源、交付格式、真实性边界和截止时间'
  if (resourceType === 'media_publishing')
    return '说明素材来源、版权归属、发布渠道、可见范围和下架联系人'
  if (resourceType === 'data_productivity')
    return '说明数据来源、分析目标、指标口径、交付格式和隐私处理'
  if (resourceType === 'quality_review')
    return '说明待检查页面/流程、目标设备、验收标准和风险重点'
  return '说明访问范围、用途和必要性'
}

function removeResourcePoolItem(item: ResourcePoolItemConfig) {
  resourceApplicationItems.value = resourceApplicationItems.value.filter(candidate =>
    !(candidate.resourceType === item.resourceType && candidate.resourceSubtype === item.resourceSubtype),
  )
  resourceApplicationForm.selectedResourceTypes = Array.from(new Set(resourceApplicationItems.value.map(candidate => candidate.resourceType)))
}

function toggleResourcePoolItem(item: ResourcePoolItemConfig) {
  if (!isResourceTypeAvailable(item.resourceType))
    return
  const shouldKeepTermsAccepted = hasAcceptedAllResourceTerms.value
  if (isSelectedResourcePoolItem(item))
    removeResourcePoolItem(item)
  else
    addResourceApplicationItem(item.resourceType, { resourceSubtype: item.resourceSubtype })
  setRequiredResourceTermsAccepted(shouldKeepTermsAccepted)
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

function openRejectionFeeDetails() {
  isRejectionFeeDetailsOpen.value = true
}

function closeRejectionFeeDetails() {
  isRejectionFeeDetailsOpen.value = false
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

function selectApplicationMode(type: ApplicationCreateMode) {
  applicationMode.value = type
  applicationForm.type = type
  resetApplicationSecurity()
  submitReadyMessage.value = ''
}

function markSubmitReady() {
  submitReadyMessage.value = '已准备就绪'
}

function classicSubmissionBlockReason() {
  if (!currentUser.value)
    return '请先登录后提交申请'
  if (!applicationForm.title.trim())
    return '请填写申请标题'
  if (!applicationForm.description.trim())
    return '请填写申请说明'
  if (!selectedApplicationPolicyStatus.value.descriptionOk)
    return `申请内容不得少于 ${selectedApplicationPolicyStatus.value.minDescriptionChars} 字`
  if (totalApplicationBytes.value > MAX_ATTACHMENT_BYTES)
    return `附件总大小不能超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}`
  if (!canCreateRequest.value)
    return `当前待处理请求已达上限，最多同时保留 ${MAX_ACTIVE_USER_REQUESTS} 个`
  if (!selectedApplicationPolicyStatus.value.available)
    return selectedApplicationPolicyStatus.value.reason || '当前暂不满足提交条件'
  if (selectedApplicationPolicyStatus.value.turnstileEnabled && !applicationSecurityForm.turnstileToken)
    return '请先完成提交安全校验'
  if (applicationForm.waiveRejectionReviewFee && isRejectionFeeWaiverBlocked.value)
    return `认真填写承诺暂不可用，请在 ${rejectionFeeWaiverBlockedUntilText.value} 后再勾选`
  if (!hasCurrentUserPointBalance(selectedPrepaidCost.value))
    return `积分不足，本次申请需要预扣 ${formatPoints(selectedPrepaidCost.value)}`

  return ''
}

function resourceSubmissionBlockReason() {
  if (!currentUser.value)
    return '请先登录后提交申请'
  if (!resourceApplicationForm.title.trim())
    return '请填写申请标题'
  if (!resourceApplicationForm.reason.trim())
    return '请填写申请说明'
  if (!resourceApplicationForm.selectedResourceTypes.length)
    return '请至少选择一种资源类型'
  if (!resourceApplicationItems.value.length)
    return '请至少添加一条资源明细'
  if (resourceApplicationForm.acceptedTermIds.length !== selectedResourceTerms.value.length)
    return '请先阅读并同意当前资源申请所需协议'
  if (!resourceApplicationPolicyStatus.value.descriptionOk)
    return `申请内容不得少于 ${resourceApplicationPolicyStatus.value.minDescriptionChars} 字`
  if (totalApplicationBytes.value > MAX_ATTACHMENT_BYTES)
    return `附件总大小不能超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}`
  if (!canCreateRequest.value)
    return `当前待处理请求已达上限，最多同时保留 ${MAX_ACTIVE_USER_REQUESTS} 个`
  if (!resourceApplicationPolicyStatus.value.available)
    return resourceApplicationPolicyStatus.value.reason || '当前暂不满足提交条件'
  if (resourceApplicationPolicyStatus.value.turnstileEnabled && !applicationSecurityForm.turnstileToken)
    return '请先完成提交安全校验'
  if (resourceApplicationForm.waiveRejectionReviewFee && isRejectionFeeWaiverBlocked.value)
    return `认真填写承诺暂不可用，请在 ${rejectionFeeWaiverBlockedUntilText.value} 后再勾选`
  if (!hasCurrentUserPointBalance(checkoutPayableEstimate.value))
    return `积分不足，本单需要预扣 ${formatPoints(checkoutPayableEstimate.value)}`

  return ''
}

function onSubmitClassicApplication() {
  const reason = classicSubmissionBlockReason()
  if (reason) {
    notify(reason)
    return
  }
  markSubmitReady()
  runSafely(async () => {
    await submitApplicationWithAiReview()
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, `${applicationMode.value === 'image' ? 'Image' : 'Pro'} 申请已提交，等待审核`)
}

function onSaveDraft() {
  runSafely(async () => {
    sanitizeSelectedResourceTypes()
    sanitizeResourceDurations()
    sanitizeLlmItems()
    if (editingDraftApplication.value)
      await updateResourceDraft(editingDraftApplication.value.id, true)
    else
      await submitResourceApplication(true)
    if (!isEditingDraft.value)
      clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, isEditingDraft.value ? '草稿已更新' : '草稿已保存')
}

function onSubmitResourceApplication() {
  sanitizeSelectedResourceTypes()
  sanitizeResourceDurations()
  sanitizeLlmItems()
  const reason = resourceSubmissionBlockReason()
  if (reason) {
    notify(reason)
    return
  }
  markSubmitReady()
  runSafely(async () => {
    sanitizeResourceDurations()
    sanitizeLlmItems()
    if (editingDraftApplication.value)
      await updateResourceDraft(editingDraftApplication.value.id, false)
    else
      await submitResourceApplication(false)
    if (!isEditingDraft.value)
      clearLocalDraft(applicationDraftKey)
    resetApplicationFiles()
    router.push('/dashboard/apply')
  }, '资源申请已提交，等待各审批组逐项审批')
}

onMounted(() => {
  applicationForm.type = applicationMode.value
  resetResourceApplicationForm()
  resetApplicationSecurity()
  if (editingDraftApplication.value) {
    fillResourceApplicationFormFromDraft(editingDraftApplication.value)
  }
  else {
    restoreLocalDraft(applicationDraftKey, resourceApplicationForm)
  }
  expandedResourcePoolCategoryIds.value = defaultExpandedResourcePoolCategoryIds()
  sanitizeDefaultFormChoices()
  sanitizeSelectedResourceTypes()
  sanitizeResourceDurations()
  sanitizeLlmItems()
  if (!isEditingDraft.value)
    stopPersistLocalDraft = persistLocalDraft(applicationDraftKey, resourceApplicationForm)
})

onBeforeUnmount(() => {
  setTermsDialogScrollLock(false)
  stopPersistLocalDraft?.()
})
</script>

<template>
  <section class="resource-create-section">
    <div class="resource-create-card">
      <div class="resource-create-header">
        <button class="resource-back-button" type="button" title="返回列表" @click="cancelCreate">
          <span class="i-carbon-chevron-left" />
        </button>
        <div class="min-w-0">
          <div class="resource-create-heading-line">
            <h2 class="resource-create-title">
              {{ currentCreateTitle }}
            </h2>
            <span class="resource-create-badge">{{ currentModeBadge }}</span>
          </div>
          <p v-if="currentModeTagline" class="resource-create-subtitle">
            {{ currentModeTagline }}
          </p>
        </div>
      </div>

      <div v-if="!isEditingDraft && isClassicApplication" class="application-mode-cards" role="tablist" aria-label="申请类型">
        <button
          v-for="item in applicationModeItems"
          :key="item.type"
          type="button"
          class="application-mode-card"
          :class="{ 'is-active': applicationMode === item.type }"
          role="tab"
          :aria-selected="applicationMode === item.type"
          @click="selectApplicationMode(item.type)"
        >
          <span class="application-mode-card__icon" :class="item.icon" />
          <span>
            <b>{{ item.title }}</b>
            <small>{{ item.description }}</small>
          </span>
          <i class="application-mode-card__check" :class="applicationMode === item.type ? 'i-carbon-checkmark-filled' : ''" />
        </button>
      </div>

      <div v-if="!currentUser" class="mt-6 p-8 text-center border border-slate-300 rounded-3xl border-dashed dark:border-slate-700">
        请先登录后提交申请。
      </div>

      <div v-else-if="isClassicApplication" class="classic-application-form mt-5">
        <div class="verification-submit-warning">
          学生认证、一线认证和开源认证都是可选辅助信息，只用于提高通过率和审核优先级；未认证也可以提交本申请。
        </div>

        <label class="gap-2 grid">
          <span class="field-label">申请标题</span>
          <TxInput v-model="applicationForm.title" />
        </label>

        <label class="gap-2 grid">
          <span class="field-label">申请说明</span>
          <RichTextEditor
            v-model="applicationForm.description"
            :min-height="260"
            :placeholder="applicationMode === 'image' ? '请说明图片用途、风格、尺寸、文字内容和限制。' : '请说明项目背景、希望解决的问题、当前上下文和预期输出。'"
          />
        </label>

        <div>
          <div class="mb-2 flex gap-3 items-center justify-between">
            <span class="field-label">附件 / 图片</span>
            <span class="field-hint">{{ formatBytes(totalApplicationBytes) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
          </div>
          <TxFileUploader v-model="applicationFiles" :max="20" button-text="上传附件" drop-text="把补充材料拖拽到这里" hint-text="全部文件总大小不超过 200MB。" />
        </div>

        <label class="option-check">
          <TxCheckbox v-model="applicationForm.extendStorage" variant="checkmark" />
          <span>
            <b>延长云端记录 7 天</b>
            <small>只在确实需要后续补充或复盘时勾选。</small>
          </span>
        </label>

        <label v-if="applicationMode === 'pro'" class="option-check">
          <TxCheckbox v-model="applicationForm.expediteProcessing" variant="checkmark" />
          <span>
            <b>Pro 加速处理</b>
            <small>按现有 Pro 加速规则额外预扣。</small>
          </span>
        </label>

        <div class="option-check" :class="{ 'is-disabled': isRejectionFeeWaiverBlocked }">
          <TxCheckbox v-model="applicationForm.waiveRejectionReviewFee" variant="checkmark" :disabled="isRejectionFeeWaiverBlocked" aria-label="认真填写承诺" />
          <span>
            <b>认真填写承诺</b>
            <small v-if="isRejectionFeeWaiverBlocked">
              当前不可勾选，请在 {{ rejectionFeeWaiverBlockedUntilText }} 后再使用。
              <button type="button" class="waiver-detail-button" @click.prevent.stop="openRejectionFeeDetails">
                详细信息
              </button>
            </small>
            <small v-else>
              若普通退回，可免除本次 AI 审核手续费；若被判定造假或不实包装，仍会扣费并触发限制。
              <button type="button" class="waiver-detail-button" @click.prevent.stop="openRejectionFeeDetails">
                详细信息
              </button>
            </small>
          </span>
        </div>

        <div v-if="(selectedApplicationPolicyStatus.turnstileEnabled && selectedApplicationPolicyStatus.turnstileSiteKey) || applicationSecurityForm.message" class="resource-confirm-card resource-security-card">
          <TurnstileChallenge
            v-if="selectedApplicationPolicyStatus.turnstileEnabled && selectedApplicationPolicyStatus.turnstileSiteKey"
            :site-key="selectedApplicationPolicyStatus.turnstileSiteKey"
            @verified="setApplicationTurnstileToken"
            @expired="setApplicationTurnstileToken('')"
          />
          <p v-if="applicationSecurityForm.message" class="field-hint">
            {{ applicationSecurityForm.message }}
          </p>
        </div>

        <div v-if="selectedApplicationPolicyStatus.reason" class="field-hint text-amber-600 dark:text-amber-300">
          {{ selectedApplicationPolicyStatus.reason }}
        </div>

        <div class="classic-application-footer resource-action-bar">
          <span class="resource-action-status">当前待处理请求：{{ activeRequestCount }}/{{ MAX_ACTIVE_USER_REQUESTS }}</span>
          <div class="resource-action-buttons">
            <span v-if="submitReadyMessage" class="submit-ready-pill" role="status" aria-live="polite">
              {{ submitReadyMessage }}
            </span>
            <TxButton variant="primary" @click="onSubmitClassicApplication">
              提交并预扣 {{ formatPoints(selectedPrepaidCost) }}
            </TxButton>
          </div>
        </div>
      </div>

      <div v-else class="resource-workbench">
        <aside class="resource-workbench-sidebar">
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

          <div class="resource-pool-card">
            <div class="resource-pool-card__head">
              <div>
                <h3>资源选择</h3>
                <p>按分类展开并勾选所需资源</p>
              </div>
            </div>
            <TxInput v-model="resourcePoolSearch" class="resource-pool-search" placeholder="搜索资源" prefix-icon="i-carbon-search" />

            <div class="resource-pool-groups">
              <section v-for="category in resourcePoolCategories" :key="category.id" class="resource-pool-group">
                <button type="button" class="resource-pool-group__header" @click="toggleResourcePoolCategory(category.id)">
                  <span class="resource-pool-group__title">
                    <i class="resource-pool-group__arrow" :class="isResourcePoolCategoryExpanded(category.id) ? 'i-carbon-chevron-down' : 'i-carbon-chevron-right'" />
                    <span class="resource-pool-group__icon" :class="category.icon" />
                    <b>{{ category.label }}</b>
                  </span>
                  <span class="resource-pool-group__count">{{ category.selectedCount }}/{{ category.totalCount }}</span>
                </button>

                <div v-if="isResourcePoolCategoryExpanded(category.id)" class="resource-pool-items">
                  <button
                    v-for="item in category.items"
                    :key="item.id"
                    type="button"
                    class="resource-pool-item"
                    :class="{ 'is-selected': item.selected, 'is-disabled': !item.available }"
                    :aria-disabled="!item.available"
                    :title="resourcePoolItemTooltip(item)"
                    @click="toggleResourcePoolItem(item)"
                  >
                    <TxCheckbox :model-value="item.selected" variant="checkmark" :disabled="!item.available" />
                    <span class="resource-pool-item__content">
                      <b>{{ item.label }}</b>
                      <span
                        v-if="item.info"
                        class="resource-pool-item__info"
                        :aria-label="resourcePoolItemTooltip(item)"
                        :data-tooltip="resourcePoolItemTooltip(item)"
                      >
                        <span class="i-carbon-information" />
                      </span>
                    </span>
                  </button>
                </div>
              </section>
              <div v-if="!resourcePoolCategories.length" class="resource-pool-empty">
                没有匹配的资源，请换个关键词继续检索。
              </div>
            </div>
          </div>
        </aside>

        <main class="resource-workbench-main">
          <div class="resource-workbench-scroll">
            <section class="resource-form-section">
              <div class="resource-section-heading">
                <span>01</span>
                <div>
                  <h3>申请信息</h3>
                  <p>填写申请背景、紧急程度与期望生效时间。</p>
                </div>
              </div>

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
            </section>

            <section class="resource-form-section">
              <div class="resource-section-heading">
                <span>02</span>
                <div>
                  <h3>资源明细</h3>
                  <p>按资源类型分组填写规格、额度、用途和预估成本。</p>
                </div>
              </div>

              <div class="space-y-5">
                <div v-for="group in groupedResourceItems" :key="group.config!.resourceType" class="p-5 border border-black/8 rounded-3xl bg-white dark:border-white/10 dark:bg-black">
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
                    <div v-for="item in group.items" :key="item.id" class="p-4 rounded-2xl bg-slate-50 dark:bg-black">
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
                          <label class="gap-2 grid"><span class="field-label">大模型</span><TxSelect v-model="item.payload.model" panel-background="pure" @update:model-value="onLlmModelChange(item)"><TxSelectItem v-for="model in selectableLlmApiModels" :key="model.key" :value="model.key" :label="llmModelSelectLabel(model)" /></TxSelect></label>
                          <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptionsForItem(item)" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span><span v-else-if="isGptProItem(item)" class="field-hint">GPT PRO 默认有效期 7 天。</span></label>
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
                              <span class="field-label">{{ llmQuotaFieldLabel(item) }}</span><b>{{ formatLlmQuotaForItem(item) }}</b>
                            </div><TxSlider v-model="item.payload.budgetLimit" :min="llmQuotaMin(item)" :max="llmQuotaMax(item)" :step="llmQuotaStep(item)" :show-value="false" :format-value="llmQuotaFormatter(item)" /><div class="quota-marks">
                              <span v-for="mark in llmQuotaMarks(item)" :key="mark">{{ formatLlmQuota(mark, llmModelForItem(item)) }}</span>
                            </div><p v-if="isGptProItem(item)" class="field-hint text-amber-600 dark:text-amber-300">
                              GPT PRO 按对话轮次申请，默认 5 轮合计约 600 积分，本期按 {{ GPT_PRO_ACTIVITY_NAME }} 处理。
                            </p><p v-else-if="item.payload.budgetLimit > 100" class="field-hint text-amber-600 dark:text-amber-300">
                              超过 $100 的额度申请需要更长时间审核
                            </p>
                          </div>
                          <label class="gap-2 grid md:col-span-2"><span class="field-label">使用场景</span><RichTextEditor v-model="item.payload.usageScenario" :min-height="140" placeholder="说明项目用途、调用场景、预估消耗和收益" /></label>
                        </template>

                        <template v-else>
                          <label class="gap-2 grid"><span class="field-label">{{ genericResourceSpecificationLabel(item.resourceType) }}</span><TxInput v-model="item.payload.specification" :placeholder="genericResourceSpecificationPlaceholder(item.resourceType)" /></label>
                          <label class="gap-2 grid"><span class="field-label">数量</span><TxNumberInput v-model="item.payload.quantity" :min="1" :step="1" :controls="false" /></label>
                          <label class="gap-2 grid"><span class="field-label">环境</span><TxSelect v-model="item.payload.environment" panel-background="pure"><TxSelectItem v-for="env in environmentOptions" :key="env" :value="env" :label="env" /></TxSelect></label>
                          <label class="gap-2 grid"><span class="field-label">有效期</span><TxSelect v-model="item.duration" panel-background="pure"><TxSelectItem v-for="option in durationOptions" :key="option.value" :value="option.value" :label="option.label" /></TxSelect><span v-if="itemDurationExtensionCost(item)" class="field-hint text-amber-600 dark:text-amber-300">延长有效期将额外预估消耗 {{ formatPoints(itemDurationExtensionCost(item)) }}，费用很高。</span></label>
                          <label class="gap-2 grid"><span class="field-label">项目</span><TxInput v-model="item.payload.project" /></label>
                          <label class="gap-2 grid"><span class="field-label">成本归属</span><TxInput v-model="item.payload.costCenter" /></label>
                          <label class="gap-2 grid md:col-span-2"><span class="field-label">{{ genericResourcePurposeLabel(item.resourceType) }}</span><RichTextEditor v-model="item.payload.purpose" :min-height="120" :placeholder="genericResourcePurposePlaceholder(item.resourceType)" /></label>
                        </template>
                      </div>
                      <div class="resource-item-attachments mt-4">
                        <div class="mb-2 flex gap-3 items-center justify-between">
                          <span class="field-label">明细附件 / 图片</span>
                          <span class="field-hint">{{ formatBytes(resourceItemAttachmentBytes(item)) }} / {{ formatBytes(MAX_ATTACHMENT_BYTES) }}</span>
                        </div>
                        <TxFileUploader v-model="item.payload.attachments" :max="20" button-text="上传明细附件" drop-text="把本条明细的图片和补充材料拖拽到这里" hint-text="仅用于当前资源明细；所有明细附件总大小不超过 200MB。" />
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
            </section>

            <section class="resource-form-section">
              <div class="resource-section-heading">
                <span>03</span>
                <div>
                  <h3>结算与提交</h3>
                  <p>核对资源成本、优惠与安全校验后直接提交。</p>
                </div>
              </div>

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
                  <span class="text-xs fw-900 px-3 py-1 rounded-full bg-slate-100 dark:bg-black">
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
                      <TxSelectItem v-for="coupon in availableResourceCoupons" :key="coupon.id" :value="coupon.id" :label="`${coupon.name} · ${couponDiscountText(coupon)}`" />
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
                <div class="option-check mt-3" :class="{ 'is-disabled': isRejectionFeeWaiverBlocked }">
                  <TxCheckbox v-model="resourceApplicationForm.waiveRejectionReviewFee" variant="checkmark" :disabled="isRejectionFeeWaiverBlocked" aria-label="认真填写承诺" />
                  <span>
                    <b>认真填写承诺</b>
                    <small v-if="isRejectionFeeWaiverBlocked">
                      当前不可勾选，请在 {{ rejectionFeeWaiverBlockedUntilText }} 后再使用。
                      <button type="button" class="waiver-detail-button" @click.prevent.stop="openRejectionFeeDetails">
                        详细信息
                      </button>
                    </small>
                    <small v-else>
                      若普通退回，可免除本次 AI 审核手续费；若管理员判定存在造假或不实包装，仍会扣费并触发限制。
                      <button type="button" class="waiver-detail-button" @click.prevent.stop="openRejectionFeeDetails">
                        详细信息
                      </button>
                    </small>
                  </span>
                </div>
                <div class="order-total-table mt-3">
                  <div>
                    <span>原价合计</span>
                    <b>{{ formatPoints(totalUndiscountedEstimate) }}</b>
                  </div>
                  <div class="is-discount" :class="{ 'is-muted': !hasActivityDiscount }">
                    <span class="order-total-label">
                      <i v-if="hasActivityDiscount" class="order-benefit-tag">限时福利</i>
                      {{ hasActivityDiscount ? `${checkoutActivityLabel} 后价格` : '暂无限时福利' }}
                    </span>
                    <b>{{ formatPoints(totalDiscountedEstimate) }}</b>
                  </div>
                  <div class="is-discount" :class="{ 'is-muted': couponDiscountAmount <= 0 }">
                    <span>优惠券抵扣</span>
                    <b>-{{ formatPoints(couponDiscountAmount) }}</b>
                  </div>
                  <div class="is-discount" :class="{ 'is-muted': squareDiscountAmount <= 0 }">
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
            </section>
          </div>

          <div class="resource-action-bar">
            <span class="resource-action-status">预计冻结：{{ formatPoints(checkoutPayableEstimate) }} · 当前待处理请求：{{ activeRequestCount }}/{{ MAX_ACTIVE_USER_REQUESTS }}</span>
            <div class="resource-action-buttons">
              <TxButton variant="secondary" @click="onSaveDraft">
                保存草稿
              </TxButton>
              <span v-if="submitReadyMessage" class="submit-ready-pill" role="status" aria-live="polite">
                {{ submitReadyMessage }}
              </span>
              <TxButton variant="primary" @click="onSubmitResourceApplication">
                提交并预扣 {{ formatPoints(checkoutPayableEstimate) }}
              </TxButton>
            </div>
          </div>
        </main>
      </div>
    </div>

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

    <div v-if="isRejectionFeeDetailsOpen" class="px-4 py-6 bg-slate-950/46 flex items-center inset-0 justify-center fixed z-50 backdrop-blur-sm" @click.self="closeRejectionFeeDetails">
      <div class="dialog-surface waiver-detail-dialog solid-panel p-6 rounded-3xl max-h-[calc(100vh-3rem)] max-w-3xl w-full overflow-auto">
        <div class="flex gap-4 items-start justify-between">
          <div>
            <h3 class="text-2xl fw-900 tracking-tight">
              认真填写承诺说明
            </h3>
            <p class="field-hint mt-2">
              这项承诺只影响退回时的 AI 审核手续费，不影响管理员是否通过申请。
            </p>
          </div>
          <button class="icon-btn shrink-0" title="关闭" @click="closeRejectionFeeDetails">
            <span class="i-carbon-close" />
          </button>
        </div>

        <div class="waiver-fee-summary mt-5">
          <div>
            <span>当前申请</span>
            <b>{{ currentRejectionFeeScenario }}</b>
          </div>
          <div>
            <span>计费基数</span>
            <b>{{ formatPoints(currentRejectionFeeBaseCost) }}</b>
          </div>
          <div>
            <span>普通退回手续费</span>
            <b>{{ formatPoints(currentEstimatedRejectionReviewFee) }}</b>
          </div>
        </div>

        <div class="waiver-detail-grid mt-5">
          <section class="waiver-detail-section">
            <h4>具体怎么收</h4>
            <p>
              未勾选承诺时，申请被普通退回会先返还申请预扣，再扣除 AI 审核手续费。手续费按最终预扣金额的 {{ rejectionFeeRateText }} 计算，最低 {{ formatPoints(REJECTION_REVIEW_FEE_MIN) }}，最高 {{ formatPoints(REJECTION_REVIEW_FEE_MAX) }}。
            </p>
            <p>
              按当前 {{ currentRejectionFeeScenario }} 的计费基数 {{ formatPoints(currentRejectionFeeBaseCost) }} 估算，若普通退回，手续费为 {{ formatPoints(currentEstimatedRejectionReviewFee) }}。
            </p>
          </section>

          <section class="waiver-detail-section">
            <h4>勾选后免什么</h4>
            <p>
              勾选并提交后，如果管理员只是认为材料不足、表达不清、必要性不够或资源暂不适配，本次普通退回免除 AI 审核手续费。
            </p>
            <p>
              免除后会进入 {{ REJECTION_FEE_WAIVER_BLOCK_DAYS }} 天冷却期，这段时间不能再次勾选认真填写承诺，但仍可按平台规则提交申请。
            </p>
          </section>

          <section class="waiver-detail-section">
            <h4>为什么要收</h4>
            <p>
              每次申请都会消耗 AI 初审、附件处理、人工复核和资源排队成本。手续费用于覆盖明显无效申请造成的审核成本，避免重复灌水、空泛描述、批量试探和低质量申请占用公益资源。
            </p>
          </section>

          <section class="waiver-detail-section">
            <h4>什么情况仍会限制</h4>
            <p>
              如果管理员判定存在造假、不实包装、冒用材料、虚构项目、隐瞒关键事实或把 AI 包装内容冒充本人经历，即使已勾选承诺，仍会扣除 {{ rejectionFeeRateText }} AI 审核手续费。
            </p>
            <p>
              造假或不实包装会触发 {{ REJECTION_FRAUD_COOLDOWN_DAYS }} 天同类申请限制，同时 {{ REJECTION_FEE_WAIVER_BLOCK_DAYS }} 天内不能再次勾选认真填写承诺。
            </p>
          </section>
        </div>

        <div class="waiver-detail-notice mt-5">
          <b>使用建议</b>
          <p>
            只有在你已经认真说明项目背景、用途、必要性、资源范围、风险边界和附件材料时再勾选。它保护认真申请被普通退回时不额外扣费，不是通过保证。
          </p>
        </div>

        <div class="mt-5 flex justify-end">
          <TxButton variant="primary" @click="closeRejectionFeeDetails">
            我知道了
          </TxButton>
        </div>
      </div>
    </div>
  </section>
</template>
