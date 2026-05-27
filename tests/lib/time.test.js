'use strict';
const { isNightTime, isTimeSafe } = require('../../src/lib/time');

describe('isNightTime', () => {
  const h = (hour) => new Date(2026, 0, 1, hour, 0, 0);

  // 23:00 – 06:00 (cross-midnight, nightStart > nightEnd)
  describe('cross-midnight range (23-6)', () => {
    test('23時 → 夜間', () => expect(isNightTime(h(23), 23, 6)).toBe(true));
    test('0時 → 夜間', () => expect(isNightTime(h(0), 23, 6)).toBe(true));
    test('5時 → 夜間', () => expect(isNightTime(h(5), 23, 6)).toBe(true));
    test('6時 → 夜間外(境界)', () => expect(isNightTime(h(6), 23, 6)).toBe(false));
    test('12時 → 夜間外', () => expect(isNightTime(h(12), 23, 6)).toBe(false));
    test('22時 → 夜間外', () => expect(isNightTime(h(22), 23, 6)).toBe(false));
  });

  // 1:00 – 5:00 (nightStart < nightEnd)
  describe('same-day range (1-5)', () => {
    test('1時 → 夜間', () => expect(isNightTime(h(1), 1, 5)).toBe(true));
    test('4時 → 夜間', () => expect(isNightTime(h(4), 1, 5)).toBe(true));
    test('5時 → 夜間外(境界)', () => expect(isNightTime(h(5), 1, 5)).toBe(false));
    test('0時 → 夜間外', () => expect(isNightTime(h(0), 1, 5)).toBe(false));
    test('23時 → 夜間外', () => expect(isNightTime(h(23), 1, 5)).toBe(false));
  });
});

describe('isTimeSafe', () => {
  test('経過0ms → safe', () => expect(isTimeSafe(60000, 1000, 1000)).toBe(true));
  test('予算内 → safe', () => expect(isTimeSafe(60000, 0, 59999)).toBe(true));
  test('ちょうど予算 → unsafe(境界)', () => expect(isTimeSafe(60000, 0, 60000)).toBe(false));
  test('予算超過 → unsafe', () => expect(isTimeSafe(60000, 0, 120000)).toBe(false));
});
