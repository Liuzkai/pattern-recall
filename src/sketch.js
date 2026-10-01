import { position, sequenceMarkup } from './render.js';

function validatePoint(point) {
  if (!Number.isInteger(point) || point < 1 || point > 9) throw new RangeError('试画点号必须是 1–9 的整数');
}

export function appendSketchPoint(sequence, next, { adjacentOnly = true } = {}) {
  validatePoint(next);
  if (!Array.isArray(sequence)) throw new TypeError('试画序列必须是数组');
  sequence.forEach(validatePoint);
  if (new Set(sequence).size !== sequence.length) throw new RangeError('试画序列不能包含重复点');
  if (typeof adjacentOnly !== 'boolean') throw new TypeError('连线规则必须是布尔值');
  const points = sequence.slice();
  if (points.includes(next)) return { points, added: [], changed: false, reason: `点 ${next} 已经使用过了` };
  const added = [];
  if (points.length) {
    const last = points.at(-1);
    const rowA = Math.floor((last - 1) / 3), colA = (last - 1) % 3;
    const rowB = Math.floor((next - 1) / 3), colB = (next - 1) % 3;
    if (adjacentOnly && (Math.abs(rowB - rowA) > 1 || Math.abs(colB - colA) > 1)) {
      return { points, added, changed: false, reason: `${last} → ${next} 跨过了整行或整列，请连接相邻点` };
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

export function sketchMatchesRule(sequence, adjacentOnly) {
  let accepted = [];
  for (const point of sequence) {
    const result = appendSketchPoint(accepted, point, { adjacentOnly });
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

export function createSketchTool({ getAdjacentOnly }) {
  const $ = selector => document.querySelector(selector);
  const pad = $('#sketch-pad');
  let points = [], pointerId = null, previous = null, guide = null, reason = '';
  $('#sketch-points').innerHTML = Array.from({ length: 9 }, (_, i) => {
    const point = i + 1;
    const [x, y] = position(point);
    return `<button class="sketch-point" type="button" data-sketch-point="${point}" style="left:${x / 1.6}%;top:${y / 1.6}%" aria-label="试画点 ${point}" aria-pressed="false">${point}</button>`;
  }).join('');

  function render() {
    const line = points.length > 1 ? `<polyline class="sketch-line" points="${points.map(point => position(point).join(',')).join(' ')}"/>` : '';
    const tail = guide && points.length ? `<line class="sketch-guide" x1="${position(points.at(-1))[0]}" y1="${position(points.at(-1))[1]}" x2="${guide.x}" y2="${guide.y}"/>` : '';
    $('#sketch-lines').innerHTML = line + tail;
    for (let point = 1; point <= 9; point++) {
      const button = $(`[data-sketch-point="${point}"]`);
      const order = points.indexOf(point);
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
    const conflict = !sketchMatchesRule(points, getAdjacentOnly());
    $('#sketch-status').textContent = reason || (conflict ? '已有连线包含跨格连接，可撤回或清空后重画' : getAdjacentOnly() ? '仅连接相邻点，允许相邻斜线' : 'Android 连线规则，经过中间点会自动补入');
    $('#sketch-status').classList.toggle('is-warning', !!reason || conflict);
  }

  function addPoint(point) {
    const result = appendSketchPoint(points, point, { adjacentOnly: getAdjacentOnly() });
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
  render();
  return { refreshRule() { reason = ''; render(); } };
}
