// The screens. State lives in store.js, the math in core.js; this file only
// turns them into HTML and handles taps.

import { CONFIG } from './config.js';
import {
  KCAL_FLOOR,
  addDays,
  computeTargets,
  diffDays,
  formatDay,
  formatNumber,
  formatTime,
  isSnackSlot,
  isValidDate,
  librarySlot,
  minutesOfDay,
  paceCheck,
  planForDate,
  planWeightOn,
  sumEntries,
  targetFor,
  todayStr,
  withTargets,
} from './core.js';
import { renderWeightChart } from './chart.js';
import { mealById, mealsForSlot } from './meals.js';
import { store } from './store.js';

const app = document.getElementById('app');
const tabsNav = document.getElementById('tabs');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
const oneDecimal = (n) => (Math.round(n * 10) / 10).toFixed(1);
const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.2v.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ------------------------------------------------------------------ routing

function parseRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'day' && isValidDate(arg)) return { name: 'day', date: arg };
  if (['plan', 'log', 'progress', 'settings'].includes(name)) return { name };
  return { name: 'today' };
}

const TAB_FOR = { today: 'today', day: 'log', plan: 'plan', log: 'log', progress: 'progress', settings: 'settings' };
const TITLE_FOR = { today: 'Today', day: 'Log', plan: 'Plan', log: 'Log', progress: 'Progress', settings: 'Settings' };

let lastRouteKey = null;
let renderedDay = null; // the date the screen was last drawn for
let freshCheck = null; // 'date:slot' of a meal ticked a moment ago, for its animation

function render() {
  const { settings } = store.state;
  const route = parseRoute();
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.key : null;

  document.body.classList.toggle('is-setup', !settings);
  if (!settings) app.innerHTML = setupView();
  else if (route.name === 'day') app.innerHTML = dayView(route.date);
  else if (route.name === 'plan') app.innerHTML = planView();
  else if (route.name === 'log') app.innerHTML = logView();
  else if (route.name === 'progress') app.innerHTML = progressView();
  else if (route.name === 'settings') app.innerHTML = settingsView();
  else app.innerHTML = dayView(todayStr());

  freshCheck = null;
  renderedDay = todayStr();

  if (settings && route.name === 'progress') {
    const target = document.getElementById('weight-chart');
    if (target) renderWeightChart(target, { weights: store.state.weights, settings });
  }

  for (const link of tabsNav.querySelectorAll('a')) {
    const on = settings && link.dataset.tab === TAB_FOR[route.name];
    link.classList.toggle('is-active', Boolean(on));
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = settings ? `${TITLE_FOR[route.name]} | ${CONFIG.appName}` : CONFIG.appName;

  const routeKey = settings ? JSON.stringify(route) : 'setup';
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    window.scrollTo(0, 0);
  } else if (focusKey) {
    const again = app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

// ------------------------------------------------------------------ day screen

function dayModel(date) {
  const { settings, swaps } = store.state;
  const target = targetFor(settings, date);
  const plan = planForDate(date, target.kcal, swaps[date] || {});
  const entries = store.entriesFor(date);
  const used = new Set();
  const rows = plan.slots.map((slot) => {
    const entry = entries.find((e) => e.slot === slot.slot && !used.has(e.id)) || null;
    if (entry) used.add(entry.id);
    return { ...slot, entry };
  });
  return {
    settings,
    target,
    plan,
    rows,
    extras: entries.filter((e) => !used.has(e.id)),
    totals: sumEntries(entries),
  };
}

function dayCountLine(date, settings) {
  const total = diffDays(settings.startDate, settings.targetDate);
  const n = diffDays(settings.startDate, date) + 1;
  if (n < 1) return 'Before your start date';
  if (n > total) return 'Past your goal date';
  return `Day ${n} of ${total}`;
}

function factsPanel(date, model) {
  const { settings, target, plan, totals } = model;
  const isToday = date === todayStr();
  const left = target.kcal - totals.kcal;
  const over = left < 0;
  const kcalPct = Math.round((totals.kcal / target.kcal) * 100);
  const proteinPct = Math.round((totals.protein / target.protein) * 100);
  const planned = plan.slots.filter((s) => s.meal).length;
  const proteinMet = totals.protein >= target.protein;

  return `
    <section class="facts" aria-labelledby="facts-title">
      <h1 class="facts__title" id="facts-title">${isToday ? 'Today&rsquo;s Facts' : esc(formatDay(date, { long: true }))}</h1>
      <p class="facts__line">${planned} ${planned === 1 ? 'meal' : 'meals'} planned, about ${formatNumber(plan.kcal)} kcal</p>
      <p class="facts__line facts__line--split">
        <strong>${esc(isToday ? formatDay(date, { long: true }) : relativeDay(date))}</strong>
        <strong>${esc(dayCountLine(date, settings))}</strong>
      </p>
      <div class="rule rule--thick"></div>
      <p class="facts__amount">${over ? 'Amount over target' : 'Amount left'}${isToday ? ' today' : ''}</p>
      <p class="facts__calories${over ? ' is-over' : ''}">
        <span class="facts__calories-label">${over ? ICON.warn : ''}Calories</span>
        <span class="facts__calories-value">${formatNumber(Math.abs(left))}</span>
      </p>
      <div class="meter meter--thick${over ? ' is-over' : ''}" role="img" aria-label="${formatNumber(totals.kcal)} of ${formatNumber(target.kcal)} calories eaten">
        <span style="width:${Math.min(100, Math.max(0, kcalPct))}%"></span>
      </div>
      <p class="facts__dv">% of daily target</p>
      <p class="facts__row"><span><strong>Eaten</strong> ${formatNumber(totals.kcal)} of ${formatNumber(target.kcal)} kcal</span><strong>${kcalPct}%</strong></p>
      <p class="facts__row"><span><strong>Protein</strong> ${totals.protein} of ${target.protein} g${proteinMet ? ', target met' : ''}</span><strong>${proteinPct}%</strong></p>
      <div class="meter" role="img" aria-label="${totals.protein} of ${target.protein} grams of protein eaten">
        <span style="width:${Math.min(100, Math.max(0, proteinPct))}%"></span>
      </div>
    </section>`;
}

function relativeDay(date) {
  const gap = diffDays(todayStr(), date);
  if (gap === -1) return 'Yesterday';
  if (gap === 1) return 'Tomorrow';
  if (gap < 0) return `${-gap} days ago`;
  return `In ${gap} days`;
}

function mealRow(row, date, isNext) {
  const { slot, label, time, meal, entry, swapped } = row;
  const shown = entry || meal;
  if (!shown) {
    const why = swapped ? 'Skipped for this day. Tap to pick one.' : 'Your meals already cover the target. Tap to pick one anyway.';
    return `
      <li class="meal is-empty">
        <span class="meal__time">${esc(formatTime(time))}</span>
        <button type="button" class="meal__open" data-action="open-swap" data-date="${date}" data-slot="${slot}" data-key="open-${slot}">
          <span class="meal__slot">${esc(label)}</span>
          <span class="meal__name">No ${esc(lower(label))} planned</span>
          <span class="meal__nums">${why}</span>
        </button>
      </li>`;
  }
  const done = Boolean(entry);
  const note = done ? '' : `${isNext ? ', next up' : ''}${swapped ? ', swapped' : ''}`;
  return `
    <li class="meal${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}">
      <span class="meal__time">${esc(formatTime(time))}</span>
      <button type="button" class="meal__open" data-action="open-meal" data-date="${date}" data-slot="${slot}" data-key="open-${slot}">
        <span class="meal__slot">${esc(label)}${note}</span>
        <span class="meal__name">${esc(shown.name)}</span>
        <span class="meal__nums">${formatNumber(shown.kcal)} kcal, ${shown.protein} g protein</span>
      </button>
      <button type="button" class="check${done && freshCheck === `${date}:${slot}` ? ' is-fresh' : ''}" role="checkbox" aria-checked="${done}" data-action="toggle-meal" data-date="${date}" data-slot="${slot}" data-key="check-${slot}"
        aria-label="${esc(label)}: ${esc(shown.name)}. ${done ? 'Logged. Tap to remove it from the log.' : 'Tap to log it.'}">${ICON.check}</button>
    </li>`;
}

/** The meal to point at: the first one not yet logged that is still due. */
function nextRow(rows, now = new Date()) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let lastLogged = -1;
  rows.forEach((r, i) => {
    if (r.entry) lastLogged = i;
  });
  const open = rows.filter((r, i) => i > lastLogged && r.meal && !r.entry);
  return open.find((r) => minutesOfDay(r.time) >= nowMinutes - 180) || open[open.length - 1] || null;
}

function dayView(date) {
  const model = dayModel(date);
  const { target, plan, rows, extras } = model;
  const isToday = date === todayStr();
  const next = isToday ? nextRow(rows) : null;
  const room = target.kcal - plan.kcal;

  return `
    ${isToday ? '' : `<a class="back" href="#/log">${ICON.back}Log</a>`}
    ${store.saveFailed ? `<p class="notice notice--warn" role="alert">${ICON.warn}<span>This browser is not saving your changes. Private browsing blocks storage; open the app in a normal window.</span></p>` : ''}
    ${factsPanel(date, model)}
    <ol class="meals" aria-label="Meals">
      ${rows.map((row) => mealRow(row, date, Boolean(next) && row.slot === next.slot)).join('')}
    </ol>
    ${room > 120 ? `<p class="hint">These meals come to about ${formatNumber(room)} kcal under your target. Add fruit, a larger portion, or log something else below.</p>` : ''}
    ${extras.length ? `
      <section class="extras" aria-labelledby="extras-title">
        <h2 id="extras-title">Also eaten</h2>
        <ul>
          ${extras.map((e) => `
            <li>
              <span class="extras__name">${esc(e.name)}</span>
              <span class="extras__nums">${formatNumber(e.kcal)} kcal${e.protein ? `, ${e.protein} g protein` : ''}</span>
              <button type="button" class="icon-btn" data-action="remove-entry" data-id="${esc(e.id)}" data-key="remove-${esc(e.id)}" aria-label="Remove ${esc(e.name)} from the log">${ICON.close}</button>
            </li>`).join('')}
        </ul>
      </section>` : ''}
    <button type="button" class="btn btn--wide" data-action="add-food" data-date="${date}" data-key="add-food">Log something else</button>`;
}

// ------------------------------------------------------------------ plan screen

function planView() {
  const { settings, swaps } = store.state;
  const today = todayStr();
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const date = addDays(today, i);
    const plan = planForDate(date, settings.kcalTarget, swaps[date] || {});
    const title = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDay(date, { long: true });
    days.push(`
      <section class="plan-day" aria-labelledby="plan-${date}">
        <div class="rule rule--medium"></div>
        <header class="plan-day__head">
          <h2 id="plan-${date}">${esc(title)}</h2>
          <p>${formatNumber(plan.kcal)} kcal, ${plan.protein} g protein</p>
        </header>
        <ol class="plan-day__meals">
          ${plan.slots.map((s) => (s.meal ? `
            <li>
              <button type="button" data-action="open-meal" data-date="${date}" data-slot="${s.slot}" data-key="plan-${date}-${s.slot}">
                <span class="plan-day__time">${esc(formatTime(s.time))}</span>
                <span class="plan-day__name">${esc(s.meal.name)}${s.swapped ? '<span class="plan-day__note">Swapped</span>' : ''}</span>
              </button>
            </li>` : '')).join('')}
        </ol>
      </section>`);
  }
  return `
    <header class="page-head">
      <h1>Plan</h1>
      <p>The next two weeks. Tap a meal for the recipe, or to swap it.</p>
    </header>
    <p class="notice">${ICON.warn}<span>No recipe uses peanuts or tree nuts. Packaged foods can still carry nut warnings, so read the label on protein powder, oats, bread, tortillas, hummus, seasoning mixes and sauces.</span></p>
    ${days.join('')}
    <section class="rules" aria-labelledby="rules-title">
      <div class="rule rule--medium"></div>
      <h2 id="rules-title">How the plan works</h2>
      <ul>
        <li>${formatNumber(settings.kcalTarget)} kcal and ${settings.proteinTarget} g protein a day, as three meals plus a snack sized to fit.</li>
        <li>Weigh in a few mornings a week. After two weeks the Progress tab compares your trend with your goal and suggests a new calorie target if you are off pace.</li>
        <li>Keep up strength training so the weight that comes off is fat, not muscle.</li>
        <li>The hummus and the sesame oil contain sesame, and a few recipes use chia seeds. Swap those meals if you avoid sesame or seeds.</li>
      </ul>
    </section>`;
}

// ------------------------------------------------------------------ log screen

function logView() {
  const { settings, log } = store.state;
  const today = todayStr();
  const byDate = new Map();
  for (const e of log) {
    const day = byDate.get(e.date) || { kcal: 0, protein: 0 };
    day.kcal += e.kcal;
    day.protein += e.protein;
    byDate.set(e.date, day);
  }
  let first = settings.startDate < today ? settings.startDate : today;
  for (const date of byDate.keys()) if (date < first) first = date;

  const week = [];
  for (let i = 0; i < 7; i += 1) {
    const day = byDate.get(addDays(today, -i));
    if (day) week.push(day);
  }
  const avg = (key) => (week.length ? Math.round(week.reduce((sum, d) => sum + d[key], 0) / week.length) : null);

  const rows = [];
  for (let date = today; date >= first && rows.length < 400; date = addDays(date, -1)) {
    const day = byDate.get(date);
    const target = targetFor(settings, date).kcal;
    const pct = day ? Math.round((day.kcal / target) * 100) : 0;
    const over = day && day.kcal > target;
    rows.push(`
      <li>
        <a class="log-row" href="${date === today ? '#/today' : `#/day/${date}`}">
          <span class="log-row__date">${date === today ? 'Today' : esc(formatDay(date))}</span>
          ${day ? `
            <span class="log-row__nums"><strong>${formatNumber(day.kcal)}</strong> of ${formatNumber(target)} kcal, ${day.protein} g protein${over ? ', over target' : ''}</span>
            <span class="meter${over ? ' is-over' : ''}" aria-hidden="true"><span style="width:${Math.min(100, pct)}%"></span></span>`
    : '<span class="log-row__nums log-row__nums--empty">Nothing logged</span>'}
          ${ICON.chevron}
        </a>
      </li>`);
  }

  return `
    <header class="page-head">
      <h1>Log</h1>
      <p>Every day since you started. Tap a day to see it or add to it.</p>
    </header>
    <dl class="stats">
      <div><dt>Days logged, last 7</dt><dd>${week.length} of 7</dd></div>
      <div><dt>Average calories on those days</dt><dd>${week.length ? formatNumber(avg('kcal')) : 'None yet'}</dd></div>
      <div><dt>Average protein</dt><dd>${week.length ? `${avg('protein')} g` : 'None yet'}</dd></div>
    </dl>
    <ul class="log-list">${rows.join('')}</ul>`;
}

// ------------------------------------------------------------------ progress screen

function paceCard(check, settings) {
  const rate = check.rate !== undefined ? oneDecimal(Math.max(0, check.rate)) : null;
  const needed = check.needed !== undefined ? oneDecimal(check.needed) : null;
  const pace = rate !== null ? `You are losing about ${rate} lb a week. Your goal needs ${needed}.` : '';
  switch (check.status) {
    case 'no-data':
      return { title: 'No weigh-ins yet', body: 'Save your weight above to start the chart.' };
    case 'reached':
      return { title: 'Goal weight reached', body: `Your latest weigh-in is at or under ${formatNumber(settings.goalWeight)} lb. Set a new goal, or a higher calorie target to hold steady, in Settings.` };
    case 'early':
      return { title: 'Too early to judge the pace', body: `The first check needs at least three weigh-ins across two weeks, about ${check.daysUntilCheck} more ${check.daysUntilCheck === 1 ? 'day' : 'days'}. The first week often shows extra water loss, so the scale settles after that.` };
    case 'on-track':
      return { title: 'On pace', body: `${pace} Keep the target at ${formatNumber(settings.kcalTarget)} kcal.` };
    case 'slow':
      return {
        title: 'Behind pace',
        body: `${pace} Eating ${formatNumber(check.suggestedKcal)} kcal a day instead of ${formatNumber(settings.kcalTarget)} should close most of the gap.`,
        action: check.suggestedKcal,
      };
    case 'floor':
      return {
        title: 'Behind pace, and already at the minimum',
        warn: true,
        body: `${pace} The plan does not go below ${formatNumber(KCAL_FLOOR)} kcal a day.${check.projectedDate ? ` At this rate you reach ${formatNumber(settings.goalWeight)} lb around ${formatDay(check.projectedDate, { year: true })}.` : ''} More daily activity or a later goal date are the safe ways to close the gap.`,
      };
    case 'fast':
      return {
        title: 'Faster than planned',
        warn: true,
        body: `${pace} That is faster than the plan calls for. Eating ${formatNumber(check.suggestedKcal)} kcal a day should bring it back to pace.`,
        action: check.suggestedKcal,
      };
    default:
      return { title: '', body: '' };
  }
}

function progressView() {
  const { settings, weights } = store.state;
  const today = todayStr();
  const latest = weights[weights.length - 1] || null;
  const todays = weights.find((w) => w.date === today);
  const current = latest ? latest.lb : settings.startWeight;
  const lost = settings.startWeight - current;
  const toGo = Math.max(0, current - settings.goalWeight);
  const daysLeft = Math.max(0, diffDays(today, settings.targetDate));
  const card = paceCard(paceCheck(weights, settings), settings);

  return `
    <header class="page-head">
      <h1>Progress</h1>
      <p>Goal: ${formatNumber(settings.goalWeight)} lb by ${esc(formatDay(settings.targetDate, { year: true }))}.</p>
    </header>
    <form class="weigh" data-form="weight" novalidate>
      <label for="weigh-input">${todays ? 'Today&rsquo;s weight, saved' : 'This morning&rsquo;s weight'}</label>
      <div class="weigh__row">
        <input id="weigh-input" name="lb" type="number" inputmode="decimal" step="0.1" min="50" max="700" value="${todays ? oneDecimal(todays.lb) : ''}" placeholder="${oneDecimal(current)}" required>
        <span class="weigh__unit">lb</span>
        <button class="btn btn--primary" data-key="save-weight">${todays ? 'Update' : 'Save'}</button>
      </div>
      <p class="form-error" role="alert" hidden></p>
    </form>
    <dl class="stats">
      <div><dt>Now</dt><dd>${oneDecimal(current)} lb</dd></div>
      <div><dt>${lost >= 0 ? 'Lost so far' : 'Gained so far'}</dt><dd>${oneDecimal(Math.abs(lost))} lb</dd></div>
      <div><dt>To go</dt><dd>${oneDecimal(toGo)} lb</dd></div>
      <div><dt>Days left</dt><dd>${daysLeft}</dd></div>
    </dl>
    <figure class="chart">
      <figcaption>
        <h2>Weight against the plan</h2>
        <p class="chart__legend"><span class="key key--weight"></span>Your weigh-ins<span class="key key--plan"></span>Plan</p>
      </figcaption>
      ${weights.length ? '<div id="weight-chart"></div>' : '<p class="empty">Save a weigh-in to draw the chart.</p>'}
    </figure>
    <section class="pace${card.warn ? ' pace--warn' : ''}" aria-labelledby="pace-title">
      <h2 id="pace-title">${card.warn ? ICON.warn : ''}${esc(card.title)}</h2>
      <p>${esc(card.body)}</p>
      ${card.action ? `<button type="button" class="btn btn--primary" data-action="apply-target" data-kcal="${card.action}" data-key="apply-target">Change target to ${formatNumber(card.action)} kcal</button>` : ''}
    </section>
    ${weights.length ? `
      <section aria-labelledby="weighins-title">
        <h2 id="weighins-title">Weigh-ins</h2>
        <table class="table">
          <thead><tr><th scope="col">Date</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Against plan</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>
          <tbody>
            ${[...weights].reverse().map((w) => {
    const gap = w.lb - planWeightOn(w.date, settings);
    const versus = Math.abs(gap) < 0.05 ? 'On plan' : `${oneDecimal(Math.abs(gap))} ${gap > 0 ? 'above' : 'below'}`;
    return `<tr><th scope="row">${esc(formatDay(w.date))}</th><td class="num">${oneDecimal(w.lb)} lb</td><td class="num">${versus}</td><td class="num"><button type="button" class="icon-btn" data-action="remove-weight" data-date="${w.date}" data-key="rw-${w.date}" aria-label="Remove the weigh-in for ${esc(formatDay(w.date))}">${ICON.close}</button></td></tr>`;
  }).join('')}
          </tbody>
        </table>
      </section>` : ''}`;
}

// ------------------------------------------------------------------ settings screen

function remindersAddress() {
  return new URL('./meal-reminders.ics', location.href).href;
}

function isIosSafariTab() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && !navigator.standalone;
}

function settingsView() {
  const { settings } = store.state;
  const today = todayStr();
  let hasMorningSnack = false;
  for (let i = 0; i < 14 && !hasMorningSnack; i += 1) {
    hasMorningSnack = planForDate(addDays(today, i), settings.kcalTarget).slots.some((s) => s.slot === 'morningSnack');
  }
  const times = Object.entries(CONFIG.mealTimes)
    .filter(([slot]) => slot !== 'morningSnack' || hasMorningSnack)
    .sort((a, b) => minutesOfDay(a[1]) - minutesOfDay(b[1]));
  const labels = { breakfast: 'Breakfast', morningSnack: 'Morning snack', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };
  const mismatch = settings.kcalTarget !== CONFIG.reminders.planKcal;

  return `
    <header class="page-head"><h1>Settings</h1></header>

    <section aria-labelledby="set-plan">
      <div class="rule rule--medium"></div>
      <h2 id="set-plan">Your plan</h2>
      <form class="form" data-form="settings" novalidate>
        <div class="field-pair">
          <div class="field"><label for="s-kcal">Daily calories</label><input id="s-kcal" name="kcalTarget" type="number" inputmode="numeric" step="50" value="${settings.kcalTarget}" required></div>
          <div class="field"><label for="s-protein">Daily protein, g</label><input id="s-protein" name="proteinTarget" type="number" inputmode="numeric" step="5" value="${settings.proteinTarget}" required></div>
        </div>
        <p class="form-note" id="recalc-note" hidden></p>
        <div class="field-pair">
          <div class="field"><label for="s-start">Starting weight, lb</label><input id="s-start" name="startWeight" type="number" inputmode="decimal" step="0.1" value="${settings.startWeight}" required></div>
          <div class="field"><label for="s-goal">Goal weight, lb</label><input id="s-goal" name="goalWeight" type="number" inputmode="decimal" step="0.1" value="${settings.goalWeight}" required></div>
        </div>
        <div class="field"><label for="s-date">Goal date</label><input id="s-date" name="targetDate" type="date" value="${esc(settings.targetDate)}" required></div>
        <div class="field-pair">
          <div class="field"><label for="s-bmr">BMR, kcal</label><input id="s-bmr" name="bmr" type="number" inputmode="numeric" step="1" value="${settings.bmr}" required></div>
          <div class="field"><label for="s-active">Average Move calories</label><input id="s-active" name="activeKcal" type="number" inputmode="numeric" step="10" value="${settings.activeKcal || ''}" placeholder="Optional"></div>
        </div>
        <p class="form-help">Average Move calories is your Apple Watch&rsquo;s daily active calories. In the Fitness app, Summary shows the average under Trends. Leave it empty and the plan assumes a moderately active day.</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row">
          <button class="btn btn--primary" data-key="save-settings">Save</button>
          <button type="button" class="btn" data-action="recalculate" data-key="recalculate">Work out calories from these numbers</button>
        </div>
      </form>
    </section>

    <section aria-labelledby="set-reminders">
      <div class="rule rule--medium"></div>
      <h2 id="set-reminders">Meal reminders</h2>
      <p>A site on GitHub Pages has no server to push notifications from, so the reminders come from your Calendar. Each one names the meal and alerts on your iPhone and Apple Watch.</p>
      <dl class="times">
        ${times.map(([slot, time]) => `<div><dt>${labels[slot]}</dt><dd>${esc(formatTime(time))}</dd></div>`).join('')}
      </dl>
      <a class="btn btn--primary btn--wide" href="./meal-reminders.ics" data-key="add-reminders">Add reminders to Calendar</a>
      <ol class="steps">
        <li>In the Calendar app, add a calendar named Meals first. Deleting that calendar later removes every reminder at once.</li>
        <li>Tap the button above, then Add All, and choose the Meals calendar.</li>
      </ol>
      <p class="form-help">If the button does nothing here, open this address in Safari:</p>
      <p class="address"><span id="reminders-address">${esc(remindersAddress())}</span><button type="button" class="btn btn--small" data-action="copy-address" data-key="copy-address">Copy</button></p>
      ${mismatch ? `<p class="notice">${ICON.warn}<span>The reminders were built for ${formatNumber(CONFIG.reminders.planKcal)} kcal a day and your target is ${formatNumber(settings.kcalTarget)}, so some snack reminders name a different snack than this app shows. The README explains how to rebuild them.</span></p>` : ''}
      <p class="form-help">To change the meal times, edit js/config.js in the repository and rebuild the reminders.</p>
    </section>

    <section aria-labelledby="set-backup">
      <div class="rule rule--medium"></div>
      <h2 id="set-backup">Backup</h2>
      <p>Your log lives only on this device. Save a copy now and then, and before you delete the app from your Home Screen.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="export-backup" data-key="export">Save a backup</button>
        <label class="btn btn--file">Restore a backup<input class="visually-hidden" id="import-file" type="file" accept=".json,application/json" data-change="import-backup"></label>
      </div>
    </section>

    <section aria-labelledby="set-reset">
      <div class="rule rule--medium"></div>
      <h2 id="set-reset">Start over</h2>
      <p>Erases your plan, log and weigh-ins from this device.</p>
      <button type="button" class="btn btn--danger" data-action="confirm-reset" data-key="reset">Erase everything</button>
    </section>

    <p class="fineprint">Calories and macros are estimates from standard food data; brands vary. This app is a planning aid, not medical advice. Talk to your doctor before a large change in diet, especially if you take medication or have a health condition.</p>`;
}

// ------------------------------------------------------------------ first-run setup

function setupView() {
  return `
    <header class="setup-head">
      <h1>${esc(CONFIG.appName)}</h1>
      <p>A meal plan, meal reminders and a meal log. Enter your numbers and it builds the plan.</p>
    </header>
    ${isIosSafariTab() ? `<p class="notice">${ICON.warn}<span>On an iPhone, add this page to your Home Screen first (Share, then Add to Home Screen) and set it up from that icon. The Home Screen app keeps its own data, separate from Safari.</span></p>` : ''}
    <form class="form" data-form="setup" novalidate>
      <div class="field-pair">
        <div class="field"><label for="f-weight">Weight now, lb</label><input id="f-weight" name="weight" type="number" inputmode="decimal" step="0.1" required></div>
        <div class="field"><label for="f-goal">Goal weight, lb</label><input id="f-goal" name="goalWeight" type="number" inputmode="decimal" step="0.1" required></div>
      </div>
      <div class="field"><label for="f-date">Goal date</label><input id="f-date" name="targetDate" type="date" value="${addDays(todayStr(), 120)}" required></div>
      <div class="field">
        <label for="f-bmr">BMR, kcal a day</label>
        <input id="f-bmr" name="bmr" type="number" inputmode="numeric" step="1" required>
        <p class="form-help">Your basal metabolic rate, from a smart scale or a BMR calculator.</p>
      </div>
      <div class="field">
        <label for="f-active">Average Move calories, optional</label>
        <input id="f-active" name="activeKcal" type="number" inputmode="numeric" step="10">
        <p class="form-help">Your Apple Watch&rsquo;s daily active calories. In the Fitness app, Summary shows the average under Trends. Leave it empty and the plan assumes a moderately active day.</p>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide" data-key="build-plan">Build my plan</button>
    </form>
    <p class="fineprint">Everything you enter stays on this device.</p>`;
}

// ------------------------------------------------------------------ sheets

let sheetOpenerKey = null;

function openSheet(html) {
  sheet.innerHTML = `
    <button type="button" class="icon-btn sheet__close" data-action="close-sheet" aria-label="Close">${ICON.close}</button>
    <div class="sheet__body">${html}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  document.body.classList.add('has-sheet');
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

sheet.addEventListener('close', () => {
  document.body.classList.remove('has-sheet');
  sheet.innerHTML = '';
  // The screen behind may have been redrawn, so find the opener again by its key.
  const opener = sheetOpenerKey ? app.querySelector(`[data-key="${CSS.escape(sheetOpenerKey)}"]`) : null;
  sheetOpenerKey = null;
  if (opener) opener.focus({ preventScroll: true });
});
sheet.addEventListener('click', (event) => {
  if (event.target === sheet) closeSheet(); // a tap on the dimmed backdrop
});

function nutritionLabel(meal) {
  return `
    <div class="label" role="group" aria-label="Nutrition facts for this meal">
      <p class="label__title">Nutrition Facts</p>
      <p class="label__line">1 serving, about ${meal.mins} ${meal.mins === 1 ? 'minute' : 'minutes'} to make</p>
      <div class="rule rule--thick"></div>
      <p class="label__calories"><span>Calories</span><span>${formatNumber(meal.kcal)}</span></p>
      <div class="rule rule--medium"></div>
      <p class="label__row"><span><strong>Total Fat</strong> ${meal.fat} g</span></p>
      <p class="label__row"><span><strong>Total Carbohydrate</strong> ${meal.carbs} g</span></p>
      <p class="label__row label__row--sub"><span>Dietary Fiber ${meal.fiber} g</span></p>
      <p class="label__row"><span><strong>Protein</strong> ${meal.protein} g</span></p>
    </div>`;
}

function openMealSheet(date, slot) {
  const row = dayModel(date).rows.find((r) => r.slot === slot);
  if (!row) return;
  if (!row.meal && !row.entry) {
    openSwapSheet(date, slot);
    return;
  }
  // Show the logged meal if there is one, otherwise the planned one.
  const meal = (row.entry && row.entry.mealId && mealById(row.entry.mealId)) || row.meal;
  const when = `${row.label}, ${formatTime(row.time)}, ${date === todayStr() ? 'today' : formatDay(date)}`;
  const loggedAt = row.entry && row.entry.at
    ? new Date(row.entry.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  openSheet(`
    <p class="sheet__context">${esc(when)}</p>
    <h2 class="sheet__title">${esc(meal ? meal.name : row.entry.name)}</h2>
    ${meal ? `
      ${nutritionLabel(meal)}
      <h3>What goes in</h3>
      <ul class="ingredients">
        ${meal.items.map(([, grams, how]) => `<li><span>${esc(how)}</span><span class="ingredients__g">${formatNumber(grams)} g</span></li>`).join('')}
      </ul>
      <h3>How to make it</h3>
      <p>${esc(meal.method)}</p>` : ''}
    <div class="sheet__actions">
      ${row.entry ? `
        <p class="sheet__status">${ICON.check}Logged${loggedAt ? ` at ${esc(loggedAt)}` : ''}</p>
        <button type="button" class="btn btn--wide" data-action="toggle-meal" data-date="${date}" data-slot="${slot}">Remove from the log</button>` : `
        <button type="button" class="btn btn--primary btn--wide" data-action="toggle-meal" data-date="${date}" data-slot="${slot}">Log this meal</button>
        <button type="button" class="btn btn--wide" data-action="open-swap" data-date="${date}" data-slot="${slot}">Swap for something else</button>`}
    </div>`);
}

function openSwapSheet(date, slot) {
  const model = dayModel(date);
  const row = model.rows.find((r) => r.slot === slot);
  if (!row) return;
  const snack = isSnackSlot(slot);
  let options = mealsForSlot(librarySlot(slot));
  let intro = `Pick a different ${lower(row.label)} for ${date === todayStr() ? 'today' : formatDay(date)}. Your snack adjusts to fit the calories left.`;
  if (snack) {
    // Rank snacks by how well they fit what the meals leave over.
    const others = model.rows.filter((r) => r.slot !== slot && r.meal).reduce((sum, r) => sum + r.meal.kcal, 0);
    const budget = Math.max(0, model.target.kcal - others);
    options = [...options].sort((a, b) => Math.abs(a.kcal - budget) - Math.abs(b.kcal - budget));
    intro = `About ${formatNumber(budget)} kcal fits ${date === todayStr() ? 'today' : `on ${formatDay(date)}`}. The closest matches are first.`;
  }
  const currentId = row.meal ? row.meal.id : 'none';

  openSheet(`
    <h2 class="sheet__title">Swap ${esc(lower(row.label))}</h2>
    <p>${esc(intro)}</p>
    <ul class="options">
      ${options.map((meal) => `
        <li>
          <button type="button" class="option${meal.id === currentId ? ' is-current' : ''}" data-action="choose-swap" data-date="${date}" data-slot="${slot}" data-meal="${meal.id}" ${meal.id === currentId ? 'aria-current="true"' : ''}>
            <span class="option__name">${esc(meal.name)}${meal.id === currentId ? '<span class="option__note">Current choice</span>' : ''}</span>
            <span class="option__nums">${formatNumber(meal.kcal)} kcal, ${meal.protein} g protein</span>
          </button>
        </li>`).join('')}
      ${snack ? `
        <li>
          <button type="button" class="option${currentId === 'none' ? ' is-current' : ''}" data-action="choose-swap" data-date="${date}" data-slot="${slot}" data-meal="none">
            <span class="option__name">No ${esc(lower(row.label))}${currentId === 'none' ? '<span class="option__note">Current choice</span>' : ''}</span>
            <span class="option__nums">0 kcal</span>
          </button>
        </li>` : ''}
    </ul>
    ${row.swapped ? `<button type="button" class="btn btn--wide" data-action="reset-swap" data-date="${date}" data-slot="${slot}">Go back to the planned ${esc(lower(row.label))}</button>` : ''}`);
}

function openAddFoodSheet(date) {
  const { recent } = store.state;
  openSheet(`
    <h2 class="sheet__title">Log something else</h2>
    <p>For anything that is not one of the planned meals: a coffee, a restaurant dinner, seconds.</p>
    <form class="form" data-form="add-food" data-date="${date}" novalidate>
      <div class="field"><label for="a-name">What was it?</label><input id="a-name" name="name" type="text" autocomplete="off" maxlength="120" required></div>
      <div class="field-pair">
        <div class="field"><label for="a-kcal">Calories</label><input id="a-kcal" name="kcal" type="number" inputmode="numeric" min="0" max="5000" step="1" required></div>
        <div class="field"><label for="a-protein">Protein, g</label><input id="a-protein" name="protein" type="number" inputmode="numeric" min="0" max="400" step="1" placeholder="Optional"></div>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide">Add to the log</button>
    </form>
    ${recent.length ? `
      <h3>Logged before</h3>
      <ul class="options">
        ${recent.map((r, i) => `
          <li>
            <button type="button" class="option" data-action="add-recent" data-date="${date}" data-index="${i}">
              <span class="option__name">${esc(r.name)}</span>
              <span class="option__nums">${formatNumber(r.kcal)} kcal${r.protein ? `, ${r.protein} g protein` : ''}</span>
            </button>
          </li>`).join('')}
      </ul>` : ''}`);
  const nameInput = sheet.querySelector('#a-name');
  if (nameInput && !matchMedia('(pointer: coarse)').matches) nameInput.focus();
}

function openPlanSummary(targets, settings) {
  const projected = Math.min(targets.projectedLoss, targets.toLose);
  const short = targets.toLose - targets.projectedLoss > 1;
  openSheet(`
    <h2 class="sheet__title">Your plan</h2>
    <div class="label" role="group" aria-label="Daily targets">
      <p class="label__title">Daily Targets</p>
      <div class="rule rule--thick"></div>
      <p class="label__calories"><span>Calories</span><span>${formatNumber(targets.kcal)}</span></p>
      <div class="rule rule--medium"></div>
      <p class="label__row"><span><strong>Protein</strong> ${targets.protein} g</span></p>
      <p class="label__row"><span><strong>Estimated daily burn</strong> ${formatNumber(targets.burn)} kcal</span></p>
      <p class="label__row"><span><strong>Daily deficit</strong> ${formatNumber(targets.deficit)} kcal</span></p>
      <p class="label__row"><span><strong>Expected loss</strong> ${oneDecimal(targets.lbPerWeek)} lb a week</span></p>
    </div>
    <p>${targets.usedWatchAverage
    ? 'The burn estimate adds your BMR, your average Move calories, and the energy it takes to digest food.'
    : 'The burn estimate assumes a moderately active day (BMR times 1.55). Add your average Move calories in Settings for a closer number.'}
      That works out to about ${formatNumber(Math.round(projected))} lb by ${esc(formatDay(settings.targetDate, { year: true }))}.</p>
    ${short ? `<p class="notice notice--warn">${ICON.warn}<span>${targets.limitedBy === 'floor'
    ? `Reaching ${formatNumber(settings.goalWeight)} lb by that date would mean eating under ${formatNumber(KCAL_FLOOR)} kcal a day, which this plan will not do.`
    : `Reaching ${formatNumber(settings.goalWeight)} lb by that date needs a faster loss than about 2 lb a week, which this plan will not do.`}
      A later goal date or more daily activity closes the gap safely.</span></p>` : ''}
    <p>Watch calorie counts are rough, so treat this as a starting point. After two weeks of weigh-ins the Progress tab checks your real pace and suggests a change if you need one.</p>
    <button type="button" class="btn btn--primary btn--wide" data-action="close-sheet">Start</button>`);
}

// ------------------------------------------------------------------ toast

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
}

// ------------------------------------------------------------------ actions

function toggleMeal(date, slot) {
  const row = dayModel(date).rows.find((r) => r.slot === slot);
  if (!row) return;
  if (row.entry) {
    store.removeEntry(row.entry.id);
    toast(`Removed ${lower(row.label)} from the log`);
  } else if (row.meal) {
    freshCheck = `${date}:${slot}`;
    store.addEntry({ date, slot, mealId: row.meal.id, name: row.meal.name, kcal: row.meal.kcal, protein: row.meal.protein });
    toast(`Logged ${lower(row.label)}, ${formatNumber(row.meal.kcal)} kcal`);
  }
}

function settingsFromForm(form) {
  const data = Object.fromEntries(new FormData(form));
  return {
    kcalTarget: Number(data.kcalTarget),
    proteinTarget: Number(data.proteinTarget),
    startWeight: Number(data.startWeight),
    goalWeight: Number(data.goalWeight),
    targetDate: String(data.targetDate || ''),
    bmr: Number(data.bmr),
    activeKcal: data.activeKcal ? Number(data.activeKcal) : null,
  };
}

function checkPlanNumbers({ weight, goalWeight, targetDate, bmr, activeKcal }, today, { futureDate = true } = {}) {
  if (!(weight >= 80 && weight <= 700)) return 'Enter your weight in pounds, between 80 and 700.';
  if (!(goalWeight >= 80 && goalWeight <= 700)) return 'Enter a goal weight in pounds, between 80 and 700.';
  if (!isValidDate(targetDate)) return 'Pick a goal date.';
  if (futureDate && diffDays(today, targetDate) < 7) return 'Pick a goal date at least a week away.';
  if (!(bmr >= 800 && bmr <= 4000)) return 'Enter your BMR in calories a day, between 800 and 4,000.';
  if (activeKcal !== null && !(activeKcal >= 0 && activeKcal <= 4000)) return 'Average Move calories should be between 0 and 4,000, or left empty.';
  return null;
}

function showError(form, message) {
  const box = form.querySelector('.form-error');
  if (!box) return;
  box.textContent = message || '';
  box.hidden = !message;
}

async function exportBackup() {
  const name = `fuel-backup-${todayStr()}.json`;
  const file = new File([store.exportJSON()], name, { type: 'application/json' });
  // On a phone the share sheet is the dependable way to save a file ("Save to Files").
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${CONFIG.appName} backup` });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Backup saved to your downloads');
}

let pendingImport = null;

const actions = {
  'toggle-meal': (el) => {
    toggleMeal(el.dataset.date, el.dataset.slot);
    closeSheet();
  },
  'open-meal': (el) => openMealSheet(el.dataset.date, el.dataset.slot),
  'open-swap': (el) => openSwapSheet(el.dataset.date, el.dataset.slot),
  'choose-swap': (el) => {
    const { date, slot, meal } = el.dataset;
    store.setSwap(date, slot, meal);
    closeSheet();
    const chosen = meal === 'none' ? null : mealById(meal);
    toast(chosen ? `Swapped to ${lower(chosen.name)}` : 'Skipped for this day');
  },
  'reset-swap': (el) => {
    store.setSwap(el.dataset.date, el.dataset.slot, null);
    closeSheet();
    toast('Back to the plan');
  },
  'add-food': (el) => openAddFoodSheet(el.dataset.date),
  'add-recent': (el) => {
    const item = store.state.recent[Number(el.dataset.index)];
    if (!item) return;
    store.addEntry({ date: el.dataset.date, slot: 'other', name: item.name, kcal: item.kcal, protein: item.protein });
    closeSheet();
    toast(`Logged ${item.name}, ${formatNumber(item.kcal)} kcal`);
  },
  'remove-entry': (el) => {
    store.removeEntry(el.dataset.id);
    toast('Removed from the log');
    const next = app.querySelector('[data-key="add-food"]');
    if (next) next.focus({ preventScroll: true });
  },
  'remove-weight': (el) => {
    store.removeWeight(el.dataset.date);
    toast('Weigh-in removed');
  },
  'apply-target': (el) => {
    const kcal = Math.max(KCAL_FLOOR, Number(el.dataset.kcal));
    const current = store.state.settings;
    store.saveSettings(withTargets(current, kcal, current.proteinTarget, todayStr()));
    toast(`Target changed to ${formatNumber(kcal)} kcal`);
  },
  recalculate: (el) => {
    const form = el.closest('form');
    const values = settingsFromForm(form);
    const today = todayStr();
    const { weights } = store.state;
    const weight = weights.length ? weights[weights.length - 1].lb : values.startWeight;
    const problem = checkPlanNumbers({ ...values, weight }, today);
    showError(form, problem);
    if (problem) return;
    const targets = computeTargets({ ...values, weight }, today);
    form.elements.kcalTarget.value = targets.kcal;
    form.elements.proteinTarget.value = targets.protein;
    const note = form.querySelector('#recalc-note');
    note.hidden = false;
    note.textContent = `From ${oneDecimal(weight)} lb today: burn about ${formatNumber(targets.burn)} kcal a day, eat ${formatNumber(targets.kcal)}, lose about ${oneDecimal(targets.lbPerWeek)} lb a week${targets.limitedBy === 'floor' ? ` (held at the ${formatNumber(KCAL_FLOOR)} kcal minimum)` : ''}${targets.limitedBy === 'pace' ? ' (held to about 2 lb a week)' : ''}. Tap Save to keep it.`;
  },
  'export-backup': () => exportBackup(),
  'confirm-reset': () => openSheet(`
    <h2 class="sheet__title">Erase everything?</h2>
    <p>This removes your plan, your meal log and your weigh-ins from this device. It cannot be undone. Save a backup first if you might want them back.</p>
    <div class="sheet__actions">
      <button type="button" class="btn btn--danger btn--wide" data-action="reset">Erase everything</button>
      <button type="button" class="btn btn--wide" data-action="close-sheet">Keep my data</button>
    </div>`),
  reset: () => {
    store.reset();
    closeSheet();
    location.hash = '#/today';
  },
  'confirm-import': () => {
    const ok = pendingImport !== null && store.importJSON(pendingImport);
    pendingImport = null;
    closeSheet();
    toast(ok ? 'Backup restored' : 'That file is not a Fuel backup');
  },
  'copy-address': async () => {
    const text = remindersAddress();
    try {
      await navigator.clipboard.writeText(text);
      toast('Address copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('reminders-address'));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      toast('Address selected. Copy it from the menu.');
    }
  },
  'close-sheet': () => closeSheet(),
};

const forms = {
  setup: (form) => {
    const data = Object.fromEntries(new FormData(form));
    const today = todayStr();
    const input = {
      weight: Number(data.weight),
      goalWeight: Number(data.goalWeight),
      targetDate: String(data.targetDate || ''),
      bmr: Number(data.bmr),
      activeKcal: data.activeKcal ? Number(data.activeKcal) : null,
    };
    const problem = checkPlanNumbers(input, today) || (input.goalWeight >= input.weight ? 'Your goal weight should be lower than your weight now.' : null);
    showError(form, problem);
    if (problem) return;
    const targets = computeTargets(input, today);
    const settings = {
      bmr: input.bmr,
      startWeight: input.weight,
      goalWeight: input.goalWeight,
      startDate: today,
      targetDate: input.targetDate,
      activeKcal: input.activeKcal,
      kcalTarget: targets.kcal,
      proteinTarget: targets.protein,
      targetChangedOn: null,
      targets: [{ from: today, kcal: targets.kcal, protein: targets.protein }],
    };
    history.replaceState(null, '', '#/today');
    if (!store.saveSettings(settings)) {
      showError(form, 'Those numbers could not be saved. Check each field and try again.');
      return;
    }
    store.setWeight(today, input.weight);
    openPlanSummary(targets, settings);
  },

  settings: (form) => {
    const values = settingsFromForm(form);
    const previous = store.state.settings;
    const today = todayStr();
    let problem = checkPlanNumbers({ ...values, weight: values.startWeight }, today, { futureDate: false });
    if (!problem && !(values.kcalTarget >= KCAL_FLOOR && values.kcalTarget <= 5000)) {
      problem = `Daily calories should be between ${formatNumber(KCAL_FLOOR)} and 5,000. The plan does not go below ${formatNumber(KCAL_FLOOR)}.`;
    }
    if (!problem && !(values.proteinTarget >= 40 && values.proteinTarget <= 400)) problem = 'Daily protein should be between 40 and 400 g.';
    showError(form, problem);
    if (problem) return;
    const { kcalTarget, proteinTarget, ...rest } = values;
    store.saveSettings(withTargets({ ...previous, ...rest }, Math.round(kcalTarget), Math.round(proteinTarget), today));
    toast('Settings saved');
  },

  weight: (form) => {
    const lb = Number(new FormData(form).get('lb'));
    const problem = lb >= 50 && lb <= 700 ? null : 'Enter your weight in pounds, between 50 and 700.';
    showError(form, problem);
    if (problem) return;
    store.setWeight(todayStr(), lb);
    toast(`Saved ${oneDecimal(lb)} lb`);
  },

  'add-food': (form) => {
    const data = Object.fromEntries(new FormData(form));
    const name = String(data.name || '').trim();
    const kcal = Number(data.kcal);
    const protein = data.protein === '' || data.protein === undefined ? 0 : Number(data.protein);
    let problem = null;
    if (!name) problem = 'Say what it was, so you recognize it in the log.';
    else if (data.kcal === '' || !(kcal >= 0 && kcal <= 5000)) problem = 'Enter the calories, between 0 and 5,000. A rough number is fine.';
    else if (!(protein >= 0 && protein <= 400)) problem = 'Protein should be between 0 and 400 g, or left empty.';
    showError(form, problem);
    if (problem) return;
    store.addEntry({ date: form.dataset.date, slot: 'other', name, kcal, protein });
    closeSheet();
    toast(`Logged ${name}, ${formatNumber(kcal)} kcal`);
  },
};

const changes = {
  'import-backup': async (input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.app !== 'fuel') throw new Error('not a backup');
      pendingImport = text;
      const days = new Set((parsed.log || []).map((e) => e.date)).size;
      openSheet(`
        <h2 class="sheet__title">Restore this backup?</h2>
        <p>It holds ${days} logged ${days === 1 ? 'day' : 'days'} and ${(parsed.weights || []).length} weigh-ins${parsed.exportedAt ? `, saved on ${esc(formatDay(String(parsed.exportedAt).slice(0, 10), { year: true }))}` : ''}. It replaces everything on this device now.</p>
        <div class="sheet__actions">
          <button type="button" class="btn btn--primary btn--wide" data-action="confirm-import">Restore the backup</button>
          <button type="button" class="btn btn--wide" data-action="close-sheet">Cancel</button>
        </div>`);
    } catch {
      pendingImport = null;
      toast('That file is not a Fuel backup');
    }
  },
};

// ------------------------------------------------------------------ wiring

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const handler = actions[el.dataset.action];
  if (!handler) return;
  if (app.contains(el) && el.dataset.key) sheetOpenerKey = el.dataset.key;
  handler(el, event);
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  const handler = forms[form.dataset.form];
  if (!handler) return;
  event.preventDefault();
  handler(form);
});

// A message about a field goes away as soon as you start fixing it.
document.addEventListener('input', (event) => {
  const form = event.target.closest('form');
  if (form) showError(form, null);
});

document.addEventListener('change', (event) => {
  const handler = changes[event.target.dataset.change];
  if (handler) handler(event.target);
});

store.subscribe(render);
window.addEventListener('hashchange', () => {
  closeSheet();
  render();
});
// When the app comes back to the front, redraw if the date has changed, and
// refresh the screens that have nothing typed into them. Screens with a form
// are left alone so a half-entered number survives a trip to another app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || sheet.open) return;
  const newDay = renderedDay !== todayStr();
  const hasForm = !store.state.settings || ['progress', 'settings'].includes(parseRoute().name);
  if (newDay || !hasForm) render();
});

render();

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocal)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
