// The weight chart on the Progress screen: your weigh-ins against the
// straight-line plan. Built as plain SVG, no library.

import { dayNumber, formatDay, monthName, planWeightOn } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 360;
const H = 232;
const PAD = { top: 18, right: 14, bottom: 26, left: 34 };

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function niceStep(range) {
  if (range <= 12) return 2;
  if (range <= 30) return 5;
  if (range <= 60) return 10;
  return 20;
}

function oneDecimal(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function formatWeight(n) {
  return Number.isInteger(n) ? String(n) : oneDecimal(n);
}

/**
 * Draw the chart into `container`.
 * weights: [{ date, lb }] sorted by date. settings: the saved plan settings.
 */
export function renderWeightChart(container, { weights, settings }) {
  container.textContent = '';
  if (!weights.length) return;

  const last = weights[weights.length - 1];
  const first = weights[0];
  const x0 = Math.min(dayNumber(settings.startDate), dayNumber(first.date));
  const x1 = Math.max(dayNumber(settings.targetDate), dayNumber(last.date));
  const values = [...weights.map((w) => w.lb), settings.startWeight, settings.goalWeight];
  const step = niceStep(Math.max(...values) - Math.min(...values));
  let y0 = Math.floor((Math.min(...values) - 1) / step) * step;
  const y1 = Math.ceil((Math.max(...values) + 1) / step) * step;
  // Leave room under the goal for its label.
  if (((settings.goalWeight - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom) < 20) y0 -= step;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const sx = (day) => PAD.left + ((day - x0) / Math.max(1, x1 - x0)) * plotW;
  const sy = (lb) => PAD.top + ((y1 - lb) / (y1 - y0)) * plotH;

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart__svg',
    role: 'img',
    tabindex: '0',
    'aria-label': `Weight chart. Latest weigh-in ${oneDecimal(last.lb)} pounds on ${formatDay(last.date)}. The plan for that day is ${oneDecimal(planWeightOn(last.date, settings))} pounds. Use the left and right arrow keys to step through weigh-ins.`,
  });

  // Horizontal gridlines and weight labels.
  for (let v = y0; v <= y1 + 0.001; v += step) {
    svg.append(el('line', { x1: PAD.left, x2: W - PAD.right, y1: sy(v), y2: sy(v), class: v === y0 ? 'chart__axis' : 'chart__grid' }));
    svg.append(el('text', { x: PAD.left - 6, y: sy(v) + 3.5, class: 'chart__tick', 'text-anchor': 'end' }, String(v)));
  }

  // Month labels along the bottom.
  const startDate = new Date(x0 * 86400000);
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1));
  while (cursor.getTime() / 86400000 <= x1) {
    const day = cursor.getTime() / 86400000;
    svg.append(el('line', { x1: sx(day), x2: sx(day), y1: sy(y0), y2: sy(y0) + 4, class: 'chart__axis' }));
    svg.append(el('text', { x: sx(day), y: H - 8, class: 'chart__tick', 'text-anchor': 'middle' }, monthName(cursor.getUTCMonth())));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  // The plan: a straight line from the starting weight to the goal.
  const planStart = dayNumber(settings.startDate);
  const planEnd = dayNumber(settings.targetDate);
  svg.append(el('line', {
    x1: sx(planStart), y1: sy(settings.startWeight), x2: sx(planEnd), y2: sy(settings.goalWeight), class: 'chart__plan',
  }));
  svg.append(el('text', {
    x: sx(planEnd), y: sy(settings.goalWeight) + 14, class: 'chart__label', 'text-anchor': 'end',
  }, `Goal ${formatWeight(settings.goalWeight)}`));

  // Your weigh-ins.
  const points = weights.map((w) => ({ ...w, x: sx(dayNumber(w.date)), y: sy(w.lb) }));
  if (points.length > 1) {
    svg.append(el('polyline', { points: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), class: 'chart__line' }));
  }
  const end = points[points.length - 1];
  svg.append(el('circle', { cx: end.x, cy: end.y, r: 4.5, class: 'chart__dot' }));
  // Label the latest value above its dot, kept inside the plot at either edge.
  svg.append(el('text', {
    x: Math.min(Math.max(end.x, PAD.left + 16), W - PAD.right - 14), y: end.y - 9, class: 'chart__label chart__label--strong', 'text-anchor': 'middle',
  }, oneDecimal(last.lb)));

  // Hover, touch and keyboard: a crosshair that snaps to the nearest weigh-in.
  // The line above the plot always reads out one weigh-in: the latest, or the
  // one under the crosshair.
  const cross = el('line', { y1: PAD.top, y2: sy(y0), class: 'chart__cross', visibility: 'hidden' });
  const focusDot = el('circle', { r: 4.5, class: 'chart__dot', visibility: 'hidden' });
  svg.append(cross, focusDot);

  const readout = document.createElement('p');
  readout.className = 'chart__readout';
  container.append(readout, svg);

  function describe(p) {
    const planned = planWeightOn(p.date, settings);
    const gap = p.lb - planned;
    readout.textContent = '';
    const value = document.createElement('strong');
    value.textContent = `${oneDecimal(p.lb)} lb`;
    const rest = document.createElement('span');
    rest.textContent = ` on ${formatDay(p.date)}, ${Math.abs(gap) < 0.05 ? 'right on the plan' : `${oneDecimal(Math.abs(gap))} lb ${gap > 0 ? 'above' : 'below'} the plan`}`;
    readout.append(value, rest);
  }

  let current = -1;
  function show(index) {
    current = Math.max(0, Math.min(points.length - 1, index));
    const p = points[current];
    cross.setAttribute('x1', p.x);
    cross.setAttribute('x2', p.x);
    cross.setAttribute('visibility', 'visible');
    focusDot.setAttribute('cx', p.x);
    focusDot.setAttribute('cy', p.y);
    focusDot.setAttribute('visibility', 'visible');
    describe(p);
  }
  function hide() {
    current = -1;
    cross.setAttribute('visibility', 'hidden');
    focusDot.setAttribute('visibility', 'hidden');
    describe(points[points.length - 1]);
  }
  describe(points[points.length - 1]);

  function nearest(clientX) {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    }
    return best;
  }
  svg.addEventListener('pointermove', (event) => show(nearest(event.clientX)));
  svg.addEventListener('pointerdown', (event) => show(nearest(event.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(points.length - 1));
  svg.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') show((current < 0 ? points.length : current) - 1);
    else if (event.key === 'ArrowRight') show(current + 1);
    else if (event.key === 'Escape') hide();
    else return;
    event.preventDefault();
  });
}
