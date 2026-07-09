import { describe, expect, it } from 'vitest'
import {
  appendWorkerStudentSupplementNotes,
  normalizeClientRequestId,
  normalizeStudentEmail,
  normalizeVerificationType,
} from '../src/worker/welfare/verifications'

describe('welfare verification helpers', () => {
  it('normalizes verification type and student email input', () => {
    expect(normalizeVerificationType('frontline')).toBe('frontline')
    expect(normalizeVerificationType('unknown')).toBe('student')
    expect(normalizeStudentEmail(' Student@EDU.Example ')).toBe('student@edu.example')
  })

  it('normalizes idempotency request ids with a bounded length', () => {
    expect(normalizeClientRequestId(null)).toBe('')
    expect(normalizeClientRequestId('  request-1  ')).toBe('request-1')
    expect(normalizeClientRequestId('x'.repeat(140))).toHaveLength(128)
  })

  it('appends student supplement notes with a fallback previous note', () => {
    const notes = appendWorkerStudentSupplementNotes('', '<p>补充说明</p>', '2026-06-01T08:30:00.000Z')

    expect(notes).toContain('<p>（此前未填写材料说明）</p>')
    expect(notes).toContain('<h3>补充资料（')
    expect(notes).toContain('</h3><p>补充说明</p>')
  })

  it('preserves previous student notes when supplementing', () => {
    const notes = appendWorkerStudentSupplementNotes('<p>原说明</p>', '<p>补充说明</p>', '2026-06-01T08:30:00.000Z')

    expect(notes.startsWith('<p>原说明</p><h3>补充资料（')).toBe(true)
  })
})
