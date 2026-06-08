export type EducationEmailCategory = 'mainland_china_university' | 'mainland_china_research' | 'overseas_university' | 'alumni_email' | 'public_email' | 'temporary_email' | 'unknown_organization' | 'invalid'
export type EducationEmailConfidence = 'high' | 'medium' | 'low'
export type EducationEmailAdminRecommendation = 'approve' | 'manual_review' | 'reject'

export interface EducationEmailProfile {
  email: string
  domain: string
  category: EducationEmailCategory
  categoryLabel: string
  confidence: EducationEmailConfidence
  adminRecommendation: EducationEmailAdminRecommendation
  reason: string
}

const EMAIL_PATTERN = /^[^\s@]+@(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}$/i

const MAINLAND_HIGHER_EDUCATION_SUFFIXES = [
  'edu.cn',
]

const MAINLAND_RESEARCH_SUFFIXES = [
  'ac.cn',
  'cas.cn',
]

const KNOWN_MAINLAND_UNIVERSITY_DOMAINS = [
  'ucas.ac.cn',
  'mails.ucas.ac.cn',
]

const OVERSEAS_EDUCATION_SUFFIXES = [
  'edu',
  'ac.uk',
  'edu.au',
  'edu.sg',
  'edu.hk',
  'edu.tw',
  'ac.jp',
  'ac.kr',
  'ac.nz',
  'edu.my',
  'edu.ph',
  'edu.vn',
  'ac.in',
  'edu.in',
  'edu.br',
  'edu.mx',
  'edu.tr',
  'edu.sa',
  'edu.qa',
]

const PUBLIC_EMAIL_DOMAINS = new Set([
  '126.com',
  '139.com',
  '163.com',
  '189.cn',
  'aliyun.com',
  'aol.com',
  'fastmail.com',
  'foxmail.com',
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'sina.com',
  'sohu.com',
  'tom.com',
  'yeah.net',
  'yahoo.com',
])

const TEMPORARY_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
])

const CATEGORY_LABELS: Record<EducationEmailCategory, string> = {
  mainland_china_university: '中国内地高校',
  mainland_china_research: '中国内地科研机构',
  overseas_university: '海外高校',
  alumni_email: '校友邮箱',
  public_email: '公共邮箱',
  temporary_email: '临时邮箱',
  unknown_organization: '机构邮箱待确认',
  invalid: '邮箱格式待确认',
}

export function normalizeEducationEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isValidEmailAddress(value: string) {
  return EMAIL_PATTERN.test(value)
}

function emailDomain(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? ''
}

function domainMatches(domain: string, suffix: string) {
  return domain === suffix || domain.endsWith(`.${suffix}`)
}

function domainMatchesAny(domain: string, suffixes: readonly string[]) {
  return suffixes.some(suffix => domainMatches(domain, suffix))
}

function hasDomainLabel(domain: string, label: string) {
  return domain.split('.').includes(label)
}

function categoryProfile(input: Omit<EducationEmailProfile, 'categoryLabel'>): EducationEmailProfile {
  return {
    ...input,
    categoryLabel: CATEGORY_LABELS[input.category],
  }
}

export function analyzeEducationEmail(value: unknown): EducationEmailProfile {
  const email = normalizeEducationEmail(value)
  const domain = emailDomain(email)
  if (!email || !isValidEmailAddress(email)) {
    return categoryProfile({
      email,
      domain,
      category: 'invalid',
      confidence: 'low',
      adminRecommendation: 'reject',
      reason: '邮箱格式无效，无法作为机构邮箱凭证',
    })
  }

  if (TEMPORARY_EMAIL_DOMAINS.has(domain)) {
    return categoryProfile({
      email,
      domain,
      category: 'temporary_email',
      confidence: 'low',
      adminRecommendation: 'reject',
      reason: '命中临时邮箱域名，不建议作为认证材料',
    })
  }

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return categoryProfile({
      email,
      domain,
      category: 'public_email',
      confidence: 'low',
      adminRecommendation: 'reject',
      reason: '命中公共邮箱域名，不能自动认定为高校或科研机构邮箱',
    })
  }

  if (hasDomainLabel(domain, 'alumni')) {
    return categoryProfile({
      email,
      domain,
      category: 'alumni_email',
      confidence: 'medium',
      adminRecommendation: 'manual_review',
      reason: '域名包含 alumni，疑似校友邮箱，建议区分在校生与校友权限',
    })
  }

  if (domainMatchesAny(domain, KNOWN_MAINLAND_UNIVERSITY_DOMAINS) || domainMatchesAny(domain, MAINLAND_HIGHER_EDUCATION_SUFFIXES)) {
    return categoryProfile({
      email,
      domain,
      category: 'mainland_china_university',
      confidence: 'high',
      adminRecommendation: 'approve',
      reason: `域名 ${domain} 命中中国内地高校域名规则`,
    })
  }

  if (domainMatchesAny(domain, MAINLAND_RESEARCH_SUFFIXES)) {
    return categoryProfile({
      email,
      domain,
      category: 'mainland_china_research',
      confidence: 'medium',
      adminRecommendation: 'manual_review',
      reason: `域名 ${domain} 命中中国内地科研机构域名规则，建议结合材料复核`,
    })
  }

  if (domainMatchesAny(domain, OVERSEAS_EDUCATION_SUFFIXES)) {
    return categoryProfile({
      email,
      domain,
      category: 'overseas_university',
      confidence: 'high',
      adminRecommendation: 'approve',
      reason: `域名 ${domain} 命中海外高校域名规则`,
    })
  }

  return categoryProfile({
    email,
    domain,
    category: 'unknown_organization',
    confidence: 'low',
    adminRecommendation: 'manual_review',
    reason: '未命中已知教育/科研域名规则，建议管理员结合学校官网或补充材料复核',
  })
}

function profileFrom(value: string | EducationEmailProfile) {
  return typeof value === 'string' ? analyzeEducationEmail(value) : value
}

function emailCategoryLabel(profile: EducationEmailProfile) {
  return profile.categoryLabel.includes('邮箱') ? profile.categoryLabel : `${profile.categoryLabel}邮箱`
}

export function educationEmailUserLabel(value: string | EducationEmailProfile, verified = false) {
  const profile = profileFrom(value)
  if (!profile.email)
    return '邮箱待填写'
  if (!verified)
    return `${emailCategoryLabel(profile)}待验证`
  if (profile.adminRecommendation === 'reject')
    return `已验证：${emailCategoryLabel(profile)}（不作为高校/科研机构凭证）`
  if (profile.adminRecommendation === 'manual_review')
    return `已验证：${emailCategoryLabel(profile)}，待管理员确认`
  return `已验证：${emailCategoryLabel(profile)}`
}

export function educationEmailAdminRecommendationLabel(value: string | EducationEmailProfile) {
  const profile = profileFrom(value)
  if (profile.adminRecommendation === 'approve')
    return '建议通过'
  if (profile.adminRecommendation === 'manual_review')
    return '建议人工复核'
  return '建议拒绝'
}

export function educationEmailReasonText(value: string | EducationEmailProfile) {
  return profileFrom(value).reason
}

export function educationEmailAdminRecommendationTone(value: string | EducationEmailProfile) {
  const profile = profileFrom(value)
  if (profile.adminRecommendation === 'approve')
    return 'success'
  if (profile.adminRecommendation === 'manual_review')
    return 'warning'
  return 'danger'
}

export function assertEducationEmailAddress(value: string) {
  const profile = analyzeEducationEmail(value)
  if (profile.category === 'invalid')
    throw new Error('请填写有效的邮箱')
}
