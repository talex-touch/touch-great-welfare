import type {
  CouponDiscountType,
  CouponScope,
  ResourceType,
  SubmitResourceApplicationPayload,
  UserCoupon,
  WelfareState,
} from '~/shared/welfare-types'
import { discountedResourceItemCost, estimatedResourceItemCost, RESOURCE_TYPE_CONFIGS } from '~/composables/welfare'
import { applyRateDiscount, DAILY_CHECK_IN_COUPON_TTL_DAYS, SQUARE_SHARE_DISCOUNT_RATE } from '~/shared/welfare-domain'

export const DEFAULT_COUPON_TTL_DAYS = DAILY_CHECK_IN_COUPON_TTL_DAYS

export function ensureCoupons(state: Partial<WelfareState>) {
  state.coupons ??= []
  return state.coupons
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function addDays(value: string, days: number) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

export function squareDiscountSnapshot(cost: number, shareToSquare: boolean) {
  if (!shareToSquare)
    return { cost, discountRate: 1, discountAmount: 0 }

  const payableCost = applyRateDiscount(cost, SQUARE_SHARE_DISCOUNT_RATE)
  return {
    cost: payableCost,
    discountRate: SQUARE_SHARE_DISCOUNT_RATE,
    discountAmount: Math.max(0, cost - payableCost),
  }
}

export function applyCouponDiscount(cost: number, coupon?: UserCoupon) {
  if (!coupon)
    return { payableCost: cost, discountAmount: 0 }

  let discountAmount = 0
  if (coupon.discountType === 'fixed_points' || coupon.discountType === 'fixed_ldc') {
    discountAmount = coupon.discountAmount ?? 0
  }
  else {
    const payableCost = applyRateDiscount(cost, coupon.discountRate)
    discountAmount = Math.max(0, cost - payableCost)
  }

  if (coupon.maxDiscount)
    discountAmount = Math.min(discountAmount, coupon.maxDiscount)

  const payableCost = Math.max(0, cost - Math.min(cost, discountAmount))
  return {
    payableCost,
    discountAmount: Math.max(0, cost - payableCost),
  }
}

export function availableResourceCoupon(state: Partial<WelfareState>, userId: string, couponId: string | undefined, cost: number, resourceTypes: ResourceType[], createdAt: string) {
  if (!couponId)
    return undefined

  const coupon = (state.coupons ?? []).find(item => item.id === couponId)
  if (!coupon || coupon.userId !== userId || coupon.usedAt)
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= new Date(createdAt).getTime())
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.scope && coupon.scope !== 'general' && coupon.scope !== 'resource')
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.minSpend && cost < coupon.minSpend)
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  if (coupon.resourceTypes?.length && !resourceTypes.some(type => coupon.resourceTypes?.includes(type)))
    throw new Error('优惠券不可用、不适用于当前资源或已过期')
  return coupon
}

export function resourceCheckoutSnapshotForState(
  state: Partial<WelfareState>,
  userId: string,
  items: SubmitResourceApplicationPayload['resourceItems'],
  couponId: string | undefined,
  createdAt: string,
  shareToSquare = false,
) {
  const baseCost = items.reduce((sum, item) => sum + estimatedResourceItemCost(item), 0)
  const activityCost = items.reduce((sum, item) => sum + discountedResourceItemCost(item, createdAt), 0)
  const resourceTypes = Array.from(new Set(items.map(item => item.resourceType)))
  const coupon = availableResourceCoupon(state, userId, couponId, activityCost, resourceTypes, createdAt)
  const couponResult = applyCouponDiscount(activityCost, coupon)
  const squareResult = squareDiscountSnapshot(couponResult.payableCost, shareToSquare)
  return {
    baseCost,
    activityCost,
    cost: squareResult.cost,
    activityDiscountRate: baseCost > 0 ? activityCost / baseCost : 1,
    activityDiscountAmount: Math.max(0, baseCost - activityCost),
    coupon,
    couponDiscountAmount: couponResult.discountAmount,
    squareDiscountRate: squareResult.discountRate,
    squareDiscountAmount: squareResult.discountAmount,
  }
}

export function createUserCouponFromRule(
  userId: string,
  source: UserCoupon['source'],
  template: Pick<NonNullable<WelfareState['couponTemplates']>[number], 'id' | 'name' | 'rule' | 'ttlDays'>,
  createdAt = new Date().toISOString(),
  codeId?: string,
): UserCoupon {
  const ttlDays = Math.max(0, Math.min(3650, Math.trunc(Number(template.ttlDays ?? DAILY_CHECK_IN_COUPON_TTL_DAYS))))
  return {
    id: createId('coupon'),
    userId,
    name: template.name,
    discountRate: Math.max(0.01, Math.min(1, Number(template.rule.discountRate ?? 1))),
    source,
    scope: template.rule.scope,
    discountType: template.rule.discountType ?? 'rate',
    discountAmount: template.rule.discountAmount,
    resourceTypes: template.rule.resourceTypes,
    minSpend: template.rule.minSpend,
    maxDiscount: template.rule.maxDiscount,
    templateId: template.id,
    codeId,
    createdAt,
    expiresAt: ttlDays > 0 ? addDays(createdAt, ttlDays) : undefined,
  }
}

export function createDailyCoupon(userId: string, source: UserCoupon['source'], discountRate: number, createdAt: string) {
  return {
    id: createId('coupon'),
    userId,
    name: source === 'daily_streak_7' ? '连续签到 7 天福利券' : '连续签到 3 天福利券',
    discountRate,
    source,
    scope: 'general',
    discountType: 'rate',
    createdAt,
    expiresAt: addDays(createdAt, DAILY_CHECK_IN_COUPON_TTL_DAYS),
  } satisfies UserCoupon
}

export function normalizeWorkerCouponRule(input: Record<string, unknown>) {
  const scope: CouponScope = input.scope === 'recharge' || input.scope === 'general' ? input.scope : 'resource'
  const discountType: CouponDiscountType = input.discountType === 'fixed_points' || input.discountType === 'fixed_ldc' || input.discountType === 'rate'
    ? input.discountType
    : scope === 'recharge' ? 'fixed_ldc' : 'rate'
  const knownTypes = new Set(RESOURCE_TYPE_CONFIGS.map(item => item.resourceType))
  return {
    scope,
    discountType,
    discountRate: Math.max(0.01, Math.min(1, Number(input.discountRate || 1))),
    discountAmount: Math.max(0, Math.trunc(Number(input.discountAmount || 0))),
    resourceTypes: Array.isArray(input.resourceTypes) ? Array.from(new Set(input.resourceTypes.filter((item): item is ResourceType => knownTypes.has(item as ResourceType)))) : [],
    minSpend: Math.max(0, Math.trunc(Number(input.minSpend || 0))),
    maxDiscount: Math.max(0, Math.trunc(Number(input.maxDiscount || 0))),
  }
}

export function createCouponCodeValue() {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}
