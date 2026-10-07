export const position = point => [32 + ((point - 1) % 3) * 48, 32 + Math.floor((point - 1) / 3) * 48];

export function sequenceMarkup(code, detailed = false) {
  return [...String(code)].map(point => `<span class="${detailed ? 'seq-number' : ''}">${point}</span>`).join('<span class="seq-arrow" aria-hidden="true">›</span>');
}

export function patternSvg(code, { showNumbers = true, animated = false } = {}) {
  const points = [...String(code)].map(Number);
  const lines = points.slice(1).map((point, index) => {
    const [x1, y1] = position(points[index]);
    const [x2, y2] = position(point);
    const dx = x2 - x1, dy = y2 - y1, distance = Math.hypot(dx, dy);
    const ux = dx / distance, uy = dy / distance;
    const ax = x1 + dx * .66, ay = y1 + dy * .66;
    const delay = `${index * .28}s`;
    return `<g ${animated ? `class="animated-node" style="animation-delay:${delay}"` : ''}><line class="pattern-line ${animated ? 'animated-segment' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${animated ? `style="animation-delay:${delay}"` : ''}/><path class="direction-marker" d="M${ax + ux * 3},${ay + uy * 3} L${ax - ux * 3 - uy * 2.5},${ay - uy * 3 + ux * 2.5} L${ax - ux * 3 + uy * 2.5},${ay - uy * 3 - ux * 2.5}Z"/></g>`;
  }).join('');
  const dots = Array.from({ length: 9 }, (_, index) => {
    const point = index + 1;
    const [x, y] = position(point);
    const order = points.indexOf(point);
    if (order === -1) return `<circle class="unused-dot" cx="${x}" cy="${y}" r="2.8"/><rect class="unused-dot square-dot" x="${x - 2.8}" y="${y - 2.8}" width="5.6" height="5.6"/>`;
    const start = order === 0, end = order === points.length - 1;
    return `<g ${animated ? `class="animated-node" style="animation-delay:${Math.max(0, order - 1) * .28}s"` : ''}><circle class="${start ? 'start-dot' : end ? 'end-dot' : 'used-dot'}" cx="${x}" cy="${y}" r="${showNumbers ? 8 : 5}"/><rect class="${start ? 'start-dot' : end ? 'end-dot' : 'used-dot'} square-dot" x="${x - (showNumbers ? 8 : 5)}" y="${y - (showNumbers ? 8 : 5)}" width="${showNumbers ? 16 : 10}" height="${showNumbers ? 16 : 10}" rx="1"/>${showNumbers ? `<text class="point-label ${start ? 'start-label' : end ? 'end-label' : ''}" x="${x}" y="${y}">${point}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="pattern-svg" viewBox="0 0 160 160" aria-hidden="true">${lines}${dots}</svg>`;
}
