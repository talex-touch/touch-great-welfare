import { describe, expect, it } from 'vitest'
import { analyzeEducationEmail, educationEmailAdminRecommendationLabel, educationEmailUserLabel } from '../src/shared/education-email'

describe('education email profile', () => {
  it('recognizes UCAS mailboxes as mainland China higher education', () => {
    const profile = analyzeEducationEmail('student@mails.ucas.ac.cn')

    expect(profile.category).toBe('mainland_china_university')
    expect(profile.confidence).toBe('high')
    expect(educationEmailAdminRecommendationLabel(profile)).toBe('建议通过')
    expect(educationEmailUserLabel(profile, true)).toBe('已验证：中国内地高校邮箱')
  })

  it('recognizes edu.cn school mailboxes', () => {
    const profile = analyzeEducationEmail('student@pku.edu.cn')

    expect(profile.category).toBe('mainland_china_university')
    expect(profile.adminRecommendation).toBe('approve')
  })

  it('recognizes overseas university domains', () => {
    const profile = analyzeEducationEmail('student@college.ac.uk')

    expect(profile.category).toBe('overseas_university')
    expect(profile.adminRecommendation).toBe('approve')
  })

  it('does not auto-approve public mailboxes', () => {
    const profile = analyzeEducationEmail('student@gmail.com')

    expect(profile.category).toBe('public_email')
    expect(profile.adminRecommendation).toBe('reject')
    expect(educationEmailUserLabel(profile, true)).toContain('不作为高校/科研机构凭证')
  })
})
