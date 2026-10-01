// Canonical Android point sequences: crossing a midpoint requires it to be visited.
const midpoint = Array.from({ length: 10 }, () => new Uint8Array(10));
for (const [a, b, middle] of [[1, 3, 2], [1, 7, 4], [3, 9, 6], [7, 9, 8], [1, 9, 5], [3, 7, 5], [2, 8, 5], [4, 6, 5]]) {
  midpoint[a][b] = midpoint[b][a] = middle;
}

function pointsToMask(points, label) {
  if (!Array.isArray(points)) throw new TypeError(`${label}必须为数组`);
  let mask = 0;
  for (const point of points) {
    if (!Number.isInteger(point) || point < 1 || point > 9) throw new RangeError(`${label}必须是 1–9 的整数`);
    mask |= 1 << (point - 1);
  }
  return mask;
}

function bitCount(mask) {
  let count = 0;
  while (mask) { mask &= mask - 1; count++; }
  return count;
}

export function validateConstraints({ included = [], excluded = [], minLength = 4, maxLength = 9 } = {}) {
  if (!Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 1 || maxLength > 9 || minLength > maxLength) {
    throw new RangeError('点数范围必须是 1–9 的整数，且最少点数不能超过最多点数');
  }
  return { required: pointsToMask(included, '必含点'), forbidden: pointsToMask(excluded, '排除点'), minLength, maxLength };
}

export function enumeratePatterns(constraints = {}) {
  const { required, forbidden, minLength, maxLength } = validateConstraints(constraints);
  const counts = new Uint32Array(10);
  if ((required & forbidden) || bitCount(required) > maxLength || 9 - bitCount(forbidden) < minLength) {
    return { patterns: new Uint32Array(0), counts, total: 0 };
  }
  const output = [];
  function visit(last, used, depth, code) {
    if (depth >= minLength && (used & required) === required) {
      output.push(code);
      counts[depth]++;
    }
    if (depth === maxLength || bitCount(required & ~used) > maxLength - depth) return;
    for (let next = 1; next <= 9; next++) {
      const bit = 1 << (next - 1);
      if ((used | forbidden) & bit) continue;
      const middle = midpoint[last][next];
      if (middle && !(used & (1 << (middle - 1)))) continue;
      visit(next, used | bit, depth + 1, code * 10 + next);
    }
  }
  for (let start = 1; start <= 9; start++) {
    const bit = 1 << (start - 1);
    if (!(forbidden & bit)) visit(start, bit, 1, start);
  }
  return { patterns: Uint32Array.from(output), counts, total: output.length };
}

export function filterByLength(patterns, length) {
  if (length === 0) return patterns;
  const minimum = 10 ** (length - 1);
  const maximum = 10 ** length;
  return patterns.filter(code => code >= minimum && code < maximum);
}

export function paginatePatterns(patterns, page = 1, pageSize = 24) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('每页数量必须为正整数');
  const pageCount = Math.max(1, Math.ceil(patterns.length / pageSize));
  const safePage = Number.isFinite(page) ? Math.min(pageCount, Math.max(1, Math.trunc(page))) : 1;
  const start = (safePage - 1) * pageSize;
  return { page: safePage, pageCount, start, end: Math.min(start + pageSize, patterns.length), items: patterns.subarray(start, start + pageSize) };
}
