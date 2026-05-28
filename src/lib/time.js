/**
 * @param {Date} date
 * @param {number} nightStart - 0-23
 * @param {number} nightEnd   - 0-23 (exclusive upper bound, may be < nightStart for cross-midnight)
 * @returns {boolean}
 */
function isNightTime_pure(date, nightStart, nightEnd) {
  const h = date.getHours();
  if (nightStart > nightEnd) {
    // cross-midnight: e.g. 23:00 – 06:00
    return h >= nightStart || h < nightEnd;
  }
  return h >= nightStart && h < nightEnd;
}

/**
 * @param {number} budgetMs   - 使用可能な残り時間(ms)
 * @param {number} scriptStart - スクリプト開始時刻(ms, Date.now() 相当)
 * @param {number} now         - 現在時刻(ms)
 * @returns {boolean}
 */
function isTimeSafe_pure(budgetMs, scriptStart, now) {
  return now - scriptStart < budgetMs;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isNightTime: isNightTime_pure, isTimeSafe: isTimeSafe_pure };
}
