import { position, sequenceMarkup } from './render.js';
import { connectionAllowed, connectionType, resolveConnectionRules } from './connections.js';

function validatePoint(point) {
  if (!Number.isInteger(point) || point < 1 || point > 9) throw new RangeError('试画点号必须是 1–9 的整数');
}

export function appendSketchPoint(sequence, next, options = {}) {
  validatePoint(next);
  if (!Array.isArray(sequence)) throw new TypeError('试画序列必须是数组');
  sequence.forEach(validatePoint);
  if (new Set(sequence).size !== sequence.length) throw new RangeError('试画序列不能包含重复点');
  const rules = resolveConnectionRules({ ...options, adjacentOnly: options.adjacentOnly === undefined ? true : options.adjacentOnly });
  const points = sequence.slice();
  if (points.includes(next)) return { points, added: [], changed: false, reason: `点 ${next} 已经使用过了` };
  const added = [];
  if (points.length) {
    const last = points.at(-1);
    const rowA = Math.floor((last - 1) / 3), colA = (last - 1) % 3;
    const rowB = Math.floor((next - 1) / 3), colB = (next - 1) % 3;
    if (!connectionAllowed(last, next, rules)) {
      const label = connectionType(last, next) === 'diagonal' ? '斜线' : '直线';
      return { points, added, changed: false, reason: `${last} → ${next} 属于${label}跨格，当前已排除` };
    }
    const middleRow = (rowA + rowB) / 2, middleCol = (colA + colB) / 2;
    if (Number.isInteger(middleRow) && Number.isInteger(middleCol)) {
      const middle = middleRow * 3 + middleCol + 1;
      if (!points.includes(middle)) added.push(middle);
    }
  }
  added.push(next);
  return { points: [...points, ...added], added, changed: true, reason: '' };
}

export function sketchMatchesRule(sequence, rules) {
  const options = typeof rules === 'boolean' ? { adjacentOnly: rules } : rules;
  let accepted = [];
  for (const point of sequence) {
    const result = appendSketchPoint(accepted, point, options);
    if (!result.changed || result.added.length !== 1) return false;
    accepted = result.points;
  }
  return true;
}

// Test the whole movement segment so a fast drag does not skip points it crosses.
export function pointsAlongSegment(from, to, radius = 12) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const hits = [];
  for (let point = 1; point <= 9; point++) {
    const [x, y] = position(point);
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared)) : 0;
    if (Math.hypot(x - from.x - t * dx, y - from.y - t * dy) <= radius) hits.push({ point, t });
  }
  return hits.sort((a, b) => a.t - b.t).map(hit => hit.point);
}

export function createSketchTool({ getConnectionRules }) {
  const $ = selector => document.querySelector(selector);
  const pad = $('#sketch-pad');
  const numberToggle = $('#sketch-show-numbers');
  let points = [], pointerId = null, previous = null, guide = null, reason = '';
  $('#sketch-points').innerHTML = Array.from({ length: 9 }, (_, i) => {
    const point = i + 1;
    const [x, y] = position(point);
    return `<button class="sketch-point" type="button" data-sketch-point="${point}" style="left:${x / 1.6}%;top:${y / 1.6}%" aria-label="试画点 ${point}" aria-pressed="false">${point}</button>`;
  }).join('');

  function render() {
    $('#sketch-points').classList.toggle('is-dot-mode', !numberToggle.checked);
    const line = points.length > 1 ? `<polyline class="sketch-line" points="${points.map(point => position(point).join(',')).join(' ')}"/>` : '';
    const tail = guide && points.length ? `<line class="sketch-guide" x1="${position(points.at(-1))[0]}" y1="${position(points.at(-1))[1]}" x2="${guide.x}" y2="${guide.y}"/>` : '';
    $('#sketch-lines').innerHTML = line + tail;
    for (let point = 1; point <= 9; point++) {
      const button = $(`[data-sketch-point="${point}"]`);
      const order = points.indexOf(point);
      button.textContent = numberToggle.checked ? String(point) : '';
      button.classList.toggle('is-used', order !== -1);
      button.classList.toggle('is-start', order === 0);
      button.classList.toggle('is-end', order > 0 && order === points.length - 1);
      button.setAttribute('aria-pressed', String(order !== -1));
      button.setAttribute('aria-label', `试画点 ${point}${order === -1 ? '' : `，第 ${order + 1} 个点`}`);
    }
    $('#sketch-sequence').innerHTML = points.length ? sequenceMarkup(points.join(''), true) : '<span class="sketch-placeholder">点序列会显示在这里</span>';
    $('#sketch-count').textContent = `${points.length} / 9 点`;
    $('#sketch-undo').disabled = !points.length;
    $('#sketch-clear').disabled = !points.length;
    const rules = getConnectionRules();
    const conflict = !sketchMatchesRule(points, rules);
    const hint = rules.excludeLongDiagonal && rules.excludeLongStraight ? '仅连接相邻点，允许相邻斜线' : rules.excludeLongDiagonal ? '排除斜线跨格，允许直线跨格' : rules.excludeLongStraight ? '排除直线跨格，允许斜线跨格' : 'Android 连线规则，经过中间点会自动补入';
    $('#sketch-status').textContent = reason || (conflict ? '已有连线包含跨格连接，已被当前规则排除，可撤回或清空后重画' : hint);
    $('#sketch-status').classList.toggle('is-warning', !!reason || conflict);
  }

  function addPoint(point) {
    const result = appendSketchPoint(points, point, getConnectionRules());
    points = result.points;
    reason = result.reason;
    render();
  }

  function coordinates(event) {
    const bounds = pad.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * 160 / (bounds.right - bounds.left), y: (event.clientY - bounds.top) * 160 / (bounds.bottom - bounds.top) };
  }

  function hitRadius() {
    const bounds = pad.getBoundingClientRect();
    return 19 * 160 / (bounds.right - bounds.left);
  }

  function move(event) {
    if (event.pointerId !== pointerId) return;
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) {
      const current = coordinates(sample);
      for (const point of pointsAlongSegment(previous, current, hitRadius())) if (!points.includes(point)) addPoint(point);
      previous = current;
      guide = current;
    }
    render();
  }

  function finish() {
    const captured = pointerId;
    pointerId = null;
    previous = null;
    guide = null;
    if (captured !== null) {
      try { pad.releasePointerCapture(captured); } catch { /* Capture may already be released by the browser. */ }
    }
    render();
  }

  pad.addEventListener('pointerdown', event => {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0) || pointerId !== null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    previous = coordinates(event);
    guide = previous;
    reason = '';
    const button = event.target.closest('[data-sketch-point]');
    if (button) {
      const point = Number(button.dataset.sketchPoint);
      if (!points.includes(point)) addPoint(point);
      button.focus();
    } else {
      for (const point of pointsAlongSegment(previous, previous, hitRadius())) if (!points.includes(point)) addPoint(point);
    }
    try { pad.setPointerCapture(pointerId); } catch { /* Clicking individual points remains available. */ }
    render();
  });
  pad.addEventListener('pointermove', move);
  pad.addEventListener('pointerup', event => { if (event.pointerId === pointerId) { move(event); finish(); } });
  pad.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) finish(); });
  pad.addEventListener('lostpointercapture', event => { if (event.pointerId === pointerId) finish(); });
  pad.addEventListener('click', event => {
    // Pointer events already handle mouse and touch; detail=0 is keyboard/AT activation.
    if (event.detail > 0) return;
    const button = event.target.closest('[data-sketch-point]');
    if (button) addPoint(Number(button.dataset.sketchPoint));
  });
  $('#sketch-undo').addEventListener('click', () => {
    finish(); points = points.slice(0, -1); reason = ''; render();
    if (!points.length) $('[data-sketch-point="1"]').focus();
  });
  $('#sketch-clear').addEventListener('click', () => {
    finish(); points = []; reason = ''; render();
    $('[data-sketch-point="1"]').focus();
  });
  numberToggle.addEventListener('change', render);
  render();
  return { refreshRule() { reason = ''; render(); } };
}
