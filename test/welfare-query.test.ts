import { describe, expect, it } from 'vitest'
import { parseOffsetParam, parsePositiveIntegerParam, parseStatusParam } from '../src/worker/welfare/query'

describe('welfare query parsing', () => {
  it('normalizes bounded positive integer params', () => {
    expect(parsePositiveIntegerParam(null, 50, 100)).toBe(50)
    expect(parsePositiveIntegerParam('-1', 50, 100)).toBe(50)
    expect(parsePositiveIntegerParam('0', 50, 100)).toBe(50)
    expect(parsePositiveIntegerParam('25.9', 50, 100)).toBe(25)
    expect(parsePositiveIntegerParam('250', 50, 100)).toBe(100)
  })

  it('normalizes offset params', () => {
    expect(parseOffsetParam(null)).toBe(0)
    expect(parseOffsetParam('-10')).toBe(0)
    expect(parseOffsetParam('2.9')).toBe(2)
  })

  it('splits status lists and drops blanks', () => {
    expect(parseStatusParam(null)).toEqual([])
    expect(parseStatusParam('pending_review, ,completed')).toEqual(['pending_review', 'completed'])
  })
})
