import test from 'node:test';
import assert from 'node:assert/strict';
import { enumeratePatterns, filterByLength, paginatePatterns } from '../src/patterns.js';
import { patternSvg } from '../src/render.js';

function independentlyValid(code) {
  const seen = new Set();
  let previous;
  for (const point of String(code).split('').map(Number)) {
    if (seen.has(point)) return false;
    if (previous) {
      const row = (Math.floor((previous - 1) / 3) + Math.floor((point - 1) / 3)) / 2;
      const column = (((previous - 1) % 3) + ((point - 1) % 3)) / 2;
      if (Number.isInteger(row) && Number.isInteger(column) && !seen.has(row * 3 + column + 1)) return false;
    }
    seen.add(point);
    previous = point;
  }
  return true;
}

const all = enumeratePatterns({ minLength: 1, maxLength: 9 });

test('start and end restrictions match independently filtering the complete search space', () => {
  for (const query of [
    { startPoint: 1, endPoint: 9, minLength: 4, maxLength: 6 },
    { startPoint: 1, minLength: 4, maxLength: 9 },
    { endPoint: 1, minLength: 4, maxLength: 9 },
    { startPoint: 2, endPoint: 3, included: [1], minLength: 3, maxLength: 3 },
    { startPoint: 5, endPoint: 5, minLength: 1, maxLength: 9 },
  ]) {
    const expected = all.patterns.filter(code => {
      const sequence = String(code);
      return sequence.length >= query.minLength && sequence.length <= query.maxLength &&
        (!query.startPoint || sequence.startsWith(String(query.startPoint))) &&
        (!query.endPoint || sequence.endsWith(String(query.endPoint))) &&
        (!query.included || query.included.every(point => sequence.includes(String(point))));
    });
    assert.deepEqual(enumeratePatterns(query).patterns, expected);
  }
  const endpoints = enumeratePatterns({ startPoint: 1, endPoint: 9, minLength: 4, maxLength: 6 });
  assert.equal(endpoints.total, 462);
  assert.deepEqual(Array.from(endpoints.counts).slice(4, 7), [18, 92, 352]);
  assert.equal(enumeratePatterns({ startPoint: 1 }).total, 38042);
  assert.equal(enumeratePatterns({ endPoint: 1 }).total, 54374);
});

test('endpoints respect midpoint, repeated-point, capacity, conflict, and input rules', () => {
  assert.deepEqual(Array.from(enumeratePatterns({ startPoint: 5, endPoint: 5, minLength: 1, maxLength: 9 }).patterns), [5]);
  for (const query of [
    { startPoint: 5, endPoint: 5, minLength: 2, maxLength: 9 },
    { startPoint: 1, excluded: [1] },
    { endPoint: 9, excluded: [9] },
    { startPoint: 1, endPoint: 9, minLength: 1, maxLength: 1 },
    { startPoint: 1, endPoint: 3, minLength: 2, maxLength: 2 },
  ]) assert.equal(enumeratePatterns(query).total, 0);
  assert.throws(() => enumeratePatterns({ startPoint: 10 }), RangeError);
  assert.throws(() => enumeratePatterns({ endPoint: -1 }), RangeError);
  assert.throws(() => enumeratePatterns({ startPoint: '1' }), RangeError);
});

test('complete enumeration matches each known count, with no duplicates or illegal midpoints', () => {
  assert.deepEqual(Array.from(all.counts), [0, 9, 56, 320, 1624, 7152, 26016, 72912, 140704, 140704]);
  assert.equal(all.total, 389497);
  assert.equal(enumeratePatterns().total, 389112);
  assert.equal(new Set(all.patterns).size, all.total);
  for (const code of all.patterns) assert.ok(independentlyValid(code), `Invalid pattern ${code}`);
});

test('included and excluded filters equal independently filtering the entire search space', () => {
  const query = { included: [1, 5], excluded: [9], minLength: 4, maxLength: 6 };
  const result = enumeratePatterns(query);
  const expected = all.patterns.filter(code => {
    const sequence = String(code);
    return sequence.length >= 4 && sequence.length <= 6 && sequence.includes('1') && sequence.includes('5') && !sequence.includes('9');
  });
  assert.equal(result.total, 7778);
  assert.deepEqual(Array.from(result.counts).slice(4, 7), [242, 1456, 6080]);
  assert.deepEqual(result.patterns, expected);
});

test('midpoints, knight moves, direction, and single points retain correct semantics', () => {
  const two = new Set(filterByLength(all.patterns, 2));
  const three = new Set(filterByLength(all.patterns, 3));
  assert.ok(!two.has(13));
  assert.ok(two.has(16));
  assert.ok(two.has(38));
  assert.ok(three.has(213));
  assert.ok(three.has(519));
  assert.ok(three.has(123));
  assert.ok(!three.has(312));
  assert.ok(!three.has(139));
  assert.equal(filterByLength(all.patterns, 1).length, 9);
});

test('conflicts and impossible constraints return no candidates; invalid inputs fail explicitly', () => {
  for (const query of [
    { included: [1], excluded: [1] },
    { included: [1, 2, 3, 4, 5], maxLength: 4 },
    { excluded: [1, 2, 3, 4, 5, 6] },
    { included: [1, 3], excluded: [2, 4, 5, 6, 7, 8, 9], minLength: 2, maxLength: 2 },
  ]) assert.equal(enumeratePatterns(query).total, 0);
  assert.throws(() => enumeratePatterns({ included: [0] }), RangeError);
  assert.throws(() => enumeratePatterns({ excluded: [2.5] }), RangeError);
  assert.throws(() => enumeratePatterns({ minLength: 7, maxLength: 4 }), RangeError);
  assert.throws(() => enumeratePatterns({ included: '1' }), TypeError);
  assert.equal(enumeratePatterns({ included: [1, 1], minLength: 1, maxLength: 1 }).total, 1);
});

test('pagination reaches every candidate exactly once and clamps invalid page numbers', () => {
  const patterns = enumeratePatterns({ minLength: 4, maxLength: 4 }).patterns;
  const first = paginatePatterns(patterns);
  assert.equal(first.pageCount, 68);
  const collected = [];
  for (let page = 1; page <= first.pageCount; page++) collected.push(...paginatePatterns(patterns, page).items);
  assert.deepEqual(collected, Array.from(patterns));
  assert.equal(paginatePatterns(patterns, 1000).items.length, 16);
  assert.equal(paginatePatterns(patterns, -1).page, 1);
  assert.equal(paginatePatterns(patterns, NaN).page, 1);
  assert.equal(paginatePatterns(new Uint32Array()).items.length, 0);
});

test('SVG render has exactly one direction arrow per segment and supports single-point diagrams', () => {
  const svg = patternSvg(213);
  assert.equal((svg.match(/class="direction-marker"/g) || []).length, 2);
  assert.equal((svg.match(/<circle /g) || []).length, 9);
  assert.match(svg, /class="start-dot" cx="80" cy="32"/);
  assert.match(svg, /class="end-dot" cx="128" cy="32"/);
  assert.doesNotMatch(patternSvg(1), /NaN|Infinity/);
  assert.doesNotMatch(patternSvg(213, { showNumbers: false }), /<text /);
});
