import { describe, expect, it } from 'vitest'
import { hasPage, type Employee } from '../types'
import { navFor } from './nav'

describe('independent seal work page', () => {
  it('appears for a granted accountant without opening tasks, and disappears when revoked', () => {
    const person: Pick<Employee, 'role' | 'canSeals' | 'pages'> = { role: 'staff', canSeals: true, pages: ['seal-work'] }
    expect(navFor(person).some((p) => p.to === '/tasks/seal-work')).toBe(true)
    expect(navFor(person).some((p) => p.to === '/tasks')).toBe(false)
    expect(hasPage(person, 'seal-work')).toBe(true)
    expect(hasPage(person, 'tasks')).toBe(false)
    expect(navFor({ ...person, pages: [] }).some((p) => p.to === '/tasks/seal-work')).toBe(false)
    expect(hasPage({ ...person, pages: [] }, 'seal-work')).toBe(false)
  })

  it('is grantable to every employee role and always available to managers', () => {
    for (const role of ['staff', 'technician', 'generation_operator', 'distribution_supervisor', 'admin', 'manager'] as const) {
      expect(navFor({ role, pages: ['seal-work'] }).filter((p) => p.to === '/tasks/seal-work')).toHaveLength(1)
    }
    expect(hasPage({ role: 'manager' }, 'seal-work')).toBe(true)
  })
})
