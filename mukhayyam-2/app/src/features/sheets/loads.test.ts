import { describe, expect, it } from 'vitest'
import { bandAverage, bandsDayAverage, bandsInSpan, emptyBandReadings, hasBandReadings, readBandReadings, readBandValues, valuesDayAverage } from './loads'

describe('loads by hour', () => {
  it('the band average needs all three readings; the day average is the mean of those bands', () => {
    const b = emptyBandReadings()
    b[0] = [45, 135, 150]
    b[1] = [30, 30, 30]
    b[2] = [10, null, 10]
    expect(bandAverage(b[0]!)).toBe(110)
    expect(bandAverage(b[2]!)).toBeNull()
    expect(bandsDayAverage(b)).toBe(70)
    expect(hasBandReadings(b)).toBe(true)
    expect(bandsDayAverage(emptyBandReadings())).toBeNull()
  })
  it('reads what is stored, even short or empty', () => {
    expect(readBandReadings(null)).toHaveLength(6)
    expect(readBandReadings([[1, '2', null]])[0]).toEqual([1, 2, null])
    expect(readBandReadings([[1, '2', null]])[5]).toEqual([null, null, null])
    expect(readBandValues([180, null, '200'])).toEqual([180, null, 200, null, null, null])
  })
  it('a generator day average skips the empty hours', () => {
    expect(valuesDayAverage([180, null, 200, null, null, 190])).toBe(190)
    expect(valuesDayAverage(undefined)).toBeNull()
  })
  it('a run touches the bands it overlaps', () => {
    expect(bandsInSpan(8 * 60, 13 * 60)).toEqual([0, 1, 2])
    expect(bandsInSpan(21 * 60, 24 * 60)).toEqual([5])
    expect(bandsInSpan(0, 6 * 60)).toEqual([])
  })
})
