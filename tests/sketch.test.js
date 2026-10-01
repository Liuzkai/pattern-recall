import test from 'node:test';
import assert from 'node:assert/strict';
import { appendSketchPoint, pointsAlongSegment, sketchMatchesRule } from '../src/sketch.js';

test('sketch independently excludes diagonal and straight crossings while inserting permitted midpoints', () => {
  for (const excludeLongDiagonal of [false, true]) {
    for (const excludeLongStraight of [false, true]) {
      const rules = { excludeLongDiagonal, excludeLongStraight };
      assert.equal(appendSketchPoint([1], 8, rules).changed, !excludeLongDiagonal);
      assert.equal(appendSketchPoint([5, 1], 9, rules).changed, !excludeLongDiagonal);
      assert.equal(appendSketchPoint([4, 1], 7, rules).changed, !excludeLongStraight);
      assert.equal(appendSketchPoint([2, 1], 3, rules).changed, !excludeLongStraight);
      assert.deepEqual(appendSketchPoint([1], 5, rules).points, [1, 5]);
      assert.deepEqual(appendSketchPoint([1], 7, rules).points, excludeLongStraight ? [1] : [1, 4, 7]);
      assert.deepEqual(appendSketchPoint([1], 9, rules).points, excludeLongDiagonal ? [1] : [1, 5, 9]);
      assert.equal(sketchMatchesRule([1, 8], rules), !excludeLongDiagonal);
      assert.equal(sketchMatchesRule([4, 1, 7], rules), !excludeLongStraight);
    }
  }
  assert.match(appendSketchPoint([1], 8).reason, /斜线跨格/);
  assert.match(appendSketchPoint([4, 1], 7).reason, /直线跨格/);
  assert.equal(appendSketchPoint([1], 8, { adjacentOnly: undefined }).changed, false, 'undefined keeps the legacy default exclusion');
  assert.equal(appendSketchPoint([1], 8, { adjacentOnly: undefined, excludeLongDiagonal: false }).changed, true, 'explicit individual fields still override the default');
  assert.throws(() => appendSketchPoint([1], 8, { excludeLongDiagonal: 'false' }), TypeError);
});

test('sketch accepts adjacent diagonals and rejects long moves without changing the input', () => {
  const input = [1];
  assert.deepEqual(appendSketchPoint(input, 5).points, [1, 5]);
  assert.deepEqual(input, [1]);
  const rejected = appendSketchPoint(input, 8);
  assert.equal(rejected.changed, false);
  assert.deepEqual(rejected.points, [1]);
  assert.match(rejected.reason, /1 → 8/);
  assert.deepEqual(appendSketchPoint([2, 1], 3).points, [2, 1]);
  assert.equal(appendSketchPoint([1, 5], 1).changed, false);
  assert.throws(() => appendSketchPoint([], 10), RangeError);
  assert.throws(() => appendSketchPoint([1, 1], 2), RangeError);
});

test('Android drawing automatically inserts unused midpoints and leaves used midpoints alone', () => {
  const rule = { adjacentOnly: false };
  assert.deepEqual(appendSketchPoint([1], 3, rule).points, [1, 2, 3]);
  assert.deepEqual(appendSketchPoint([1], 9, rule).points, [1, 5, 9]);
  assert.deepEqual(appendSketchPoint([2, 1], 3, rule).added, [3]);
  assert.deepEqual(appendSketchPoint([1], 8, rule).added, [8]);
  assert.equal(sketchMatchesRule([2, 1, 3], false), true);
  assert.equal(sketchMatchesRule([2, 1, 3], true), false);
  assert.equal(sketchMatchesRule([1, 3], false), false);
  assert.equal(sketchMatchesRule([1, 5, 9], true), true);
  assert.equal(sketchMatchesRule([], true), true);
});

test('segment hit detection sees crossed points in travel order and avoids distant points', () => {
  assert.deepEqual(pointsAlongSegment({ x: 32, y: 32 }, { x: 128, y: 32 }), [1, 2, 3]);
  assert.deepEqual(pointsAlongSegment({ x: 128, y: 32 }, { x: 32, y: 32 }), [3, 2, 1]);
  assert.deepEqual(pointsAlongSegment({ x: 32, y: 32 }, { x: 128, y: 128 }), [1, 5, 9]);
  assert.deepEqual(pointsAlongSegment({ x: 32, y: 32 }, { x: 80, y: 128 }), [1, 8]);
  assert.deepEqual(pointsAlongSegment({ x: 80, y: 80 }, { x: 80, y: 80 }), [5]);
  assert.deepEqual(pointsAlongSegment({ x: -100, y: -100 }, { x: -50, y: -50 }), []);
});

test('a fast drag includes intermediate points while used points cannot authorize long adjacent moves', () => {
  const hits = pointsAlongSegment({ x: 32, y: 32 }, { x: 128, y: 32 });
  let sequence = [1];
  for (const point of hits) if (!sequence.includes(point)) sequence = appendSketchPoint(sequence, point).points;
  assert.deepEqual(sequence, [1, 2, 3]);
  sequence = [2, 1];
  for (const point of hits) if (!sequence.includes(point)) sequence = appendSketchPoint(sequence, point).points;
  assert.deepEqual(sequence, [2, 1]);
});
