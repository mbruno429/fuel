// The screens. State lives in store.js, the math in core.js; this file only
// turns them into HTML and handles taps.

import { CONFIG } from './config.js';
import { nutWordIn } from './allergens.js';
import {
  KCAL_FLOOR,
  SLOT_LABELS,
  addDays,
  buildRemindersICS,
  computeTargets,
  diffDays,
  formatDay,
  formatNumber,
  formatTime,
  getMealTimes,
  isSnackSlot,
  isValidDate,
  isValidTime,
  librarySlot,
  minutesOfDay,
  monthName,
  orderedSlots,
  paceCheck,
  planForDate,
  planWeightOn,
  remindersSignature,
  rotationIndex,
  setMealTimes,
  sumEntries,
  targetFor,
  todayStr,
  weekdayIndex,
  withTargets,
} from './core.js';
import { FOODS, FOOD_NAMES } from './foods.js';
import { renderWeightChart } from './chart.js';
import {
  AISLES,
  DAY_CHOICES,
  MAX_SERVINGS,
  PER_LB,
  STORE_BRAND,
  allStores,
  amountText,
  fitBudget,
  formatMoney,
  listAsText,
  makeOffer,
  readCatalog,
  shownStores,
  unitsFor,
  withTypical,
} from './grocery.js';
import {
  BASE_ROTATION,
  MAIN_SLOTS,
  MAX_GRAMS,
  MEALS,
  METHOD_MAX,
  NAME_MAX,
  ROTATION,
  SLOTS,
  applyMealChanges,
  baseMeal,
  cleanFacts,
  gramsText,
  ingredientText,
  mealById,
  mealsForSlot,
  mealsVersion,
  nutritionFor,
} from './meals.js';
import {
  NEW_KEY_URL,
  calendarUrls,
  checkKey,
  guessRepo,
  isClassicKey,
  isRepoName,
  looksLikeKey,
  publishFile,
  sameCalendar,
} from './publish.js';
import { keyStore, store } from './store.js';

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
  if (name === 'settings' && Object.hasOwn(SETTINGS_PAGES, arg || '')) return { name: 'settings', page: arg };
  if (['plan', 'groceries', 'log', 'progress', 'settings'].includes(name)) return { name };
  return { name: 'today' };
}

const TAB_FOR = { today: 'today', day: 'log', plan: 'plan', groceries: 'plan', log: 'log', progress: 'progress', settings: 'settings' };
const TITLE_FOR = { today: 'Today', day: 'Log', plan: 'Plan', groceries: 'Groceries', log: 'Log', progress: 'Progress', settings: 'Settings' };

let lastRouteKey = null;
let anchor = null; // the control being tapped and where it sat, so a redraw can keep it under the finger
let renderedDay = null; // the date the screen was last drawn for
let freshCheck = null; // 'date:slot' of a meal ticked a moment ago, for its animation

function render() {
  applyCustom();
  const { settings } = store.state;
  const route = parseRoute();
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.key : null;

  document.body.classList.toggle('is-setup', !settings);
  if (!settings) app.innerHTML = setupView();
  else if (route.name === 'day') app.innerHTML = dayView(route.date);
  else if (route.name === 'plan') app.innerHTML = planView();
  else if (route.name === 'groceries') app.innerHTML = groceriesView();
  else if (route.name === 'log') app.innerHTML = logView();
  else if (route.name === 'progress') app.innerHTML = progressView();
  else if (route.name === 'settings') app.innerHTML = route.page ? settingsPage(route.page) : settingsView();
  else app.innerHTML = dayView(todayStr());

  freshCheck = null;
  freshTick = null;
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
  const title = route.page ? SETTINGS_PAGES[route.page] : TITLE_FOR[route.name];
  document.title = settings ? `${title} | ${CONFIG.appName}` : CONFIG.appName;

  const routeKey = settings ? JSON.stringify(route) : 'setup';
  if (routeKey !== lastRouteKey) {
    lastRouteKey = routeKey;
    window.scrollTo(0, 0);
    return;
  }
  if (anchor) {
    // Something above the tapped control may have grown or shrunk. Scroll by
    // the difference so the control does not move on the screen.
    const moved = app.querySelector(`[data-key="${CSS.escape(anchor.key)}"]`);
    const shift = moved ? moved.getBoundingClientRect().top - anchor.top : 0;
    if (Math.abs(shift) > 1) window.scrollBy(0, shift);
  }
  if (focusKey) {
    const again = app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}

/** Run a tap or change handler, remembering where its control sits for the redraw it causes. */
function withAnchor(el, run) {
  anchor = app.contains(el) && el.dataset.key ? { key: el.dataset.key, top: el.getBoundingClientRect().top } : null;
  try {
    run();
  } finally {
    anchor = null;
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
    ${groceryLink()}
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

function isIosSafariTab() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && !navigator.standalone;
}

function settingsView() {
  const { settings } = store.state;

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

    ${hubRows()}

    <section aria-labelledby="set-backup">
      <div class="rule rule--medium"></div>
      <h2 id="set-backup">Backup</h2>
      <p>Your log, your weigh-ins, your meal changes and the grocery prices you record live only on this device. Save a copy now and then, and before you delete the app from your Home Screen. The GitHub key is never in a backup.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="export-backup" data-key="export">Save a backup</button>
        <label class="btn btn--file">Restore a backup<input class="visually-hidden" id="import-file" type="file" accept=".json,application/json" data-change="import-backup"></label>
      </div>
    </section>

    <section aria-labelledby="set-reset">
      <div class="rule rule--medium"></div>
      <h2 id="set-reset">Start over</h2>
      <p>Erases your plan, log, weigh-ins and grocery choices from this device.</p>
      <button type="button" class="btn btn--danger" data-action="confirm-reset" data-key="reset">Erase everything</button>
    </section>

    <p class="fineprint">Calories and macros are estimates from standard food data; brands vary. This app is a planning aid, not medical advice. Talk to your doctor before a large change in diet, especially if you take medication or have a health condition.</p>`;
}

// ------------------------------------------------------------------ grocery screen

let catalog = null; // the price list, once it has been pulled
let catalogState = 'loading'; // 'loading' | 'ready' | 'failed'
let groceryMemo = null;
let freshTick = null; // id of an item ticked a moment ago, for its animation

/** Pull the price list. Offline, the service worker answers from its saved copy. */
async function pullPriceList() {
  if (!catalog) catalogState = 'loading';
  try {
    const response = await fetch(CONFIG.grocery.priceList, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const read = readCatalog(await response.json());
    if (!read.catalog) throw new Error('unreadable');
    catalog = read.catalog;
    catalogState = 'ready';
  } catch {
    if (!catalog) catalogState = 'failed';
  }
  groceryMemo = null;
  if (store.state.settings && !sheet.open && ['groceries', 'plan', 'settings'].includes(parseRoute().name)) render();
}

/** Slots already logged, by date, from a date on. Those meals need no shopping. */
function loggedSince(from) {
  const logged = {};
  for (const entry of store.state.log) {
    if (entry.date >= from && entry.slot !== 'other') (logged[entry.date] = logged[entry.date] || []).push(entry.slot);
  }
  return logged;
}

/** The list and its budget check for today. Worked out once per change, not once per redraw. */
function groceryModel() {
  const { settings, swaps, grocery } = store.state;
  const today = todayStr();
  const logged = loggedSince(today);
  const key = JSON.stringify([today, catalog.updated, grocery, swaps, logged, settings.targets, settings.kcalTarget, settings.proteinTarget, mealsVersion()]);
  if (groceryMemo && groceryMemo.key === key) return groceryMemo.fit;
  const fit = fitBudget({
    catalog: shopCatalog(),
    customStores: grocery.stores,
    hiddenStores: grocery.hidden,
    storeId: grocery.store,
    start: today,
    days: grocery.days,
    kcalFor: (date) => targetFor(settings, date).kcal,
    proteinFor: (date) => targetFor(settings, date).protein,
    swaps,
    logged,
    servings: grocery.servings,
    prefs: grocery.prefs,
    offers: grocery.offers,
    lots: grocery.lots,
    budget: grocery.budget,
  });
  groceryMemo = { key, fit };
  return fit;
}

const shortDate = (date) => `${monthName(Number(date.slice(5, 7)) - 1)} ${Number(date.slice(8, 10))}`;

function storeName(id) {
  const found = allStores(catalog, store.state.grocery.stores).find((s) => s.id === id);
  return found ? found.name : 'another store';
}

/** '~$4.79' for a typical price, '$4.79' for one you recorded, with the spoken form for screen readers. */
function priceHtml(cents, estimate) {
  return `<span aria-hidden="true">${estimate ? '~' : ''}${formatMoney(cents)}</span><span class="visually-hidden">${estimate ? 'about ' : ''}${formatMoney(cents)}</span>`;
}

/** A budget: '$150' when it is a whole number of dollars, '$149.50' otherwise. */
function budgetText(cents) {
  return cents % 100 === 0 ? formatMoney(cents).slice(0, -3) : formatMoney(cents);
}

function offerPrice(offer) {
  if (offer.kind === 'weight') return `${formatMoney(offer.cents)} per lb`;
  if (offer.label === 'each') return `${formatMoney(offer.cents)} each`;
  return `${formatMoney(offer.cents)} per ${offer.label}`;
}

function groceryFacts(fit) {
  const { list, budgetCents, status } = fit;
  const count = list.lines.length;
  const hasBudget = status !== 'none';
  const left = budgetCents - list.totalCents;
  const over = hasBudget && left < 0;
  const estimated = list.recordedCount < count;
  const about = estimated ? 'about ' : '';
  let amount = estimated ? 'Estimated cost of this list' : 'Cost of this list';
  let dollars = Math.round(list.totalCents / 100);
  if (hasBudget) {
    amount = `${estimated ? 'Estimated amount' : 'Amount'} ${over ? 'over' : 'left in'} your budget`;
    dollars = over ? Math.ceil(-left / 100) : Math.floor(left / 100);
  }
  const pct = hasBudget ? Math.round((list.totalCents / budgetCents) * 100) : 0;
  const usedPct = hasBudget ? Math.round((list.usedCents / budgetCents) * 100) : 0;

  return `
    <section class="facts" aria-labelledby="grocery-title">
      <h1 class="facts__title" id="grocery-title">Grocery Facts</h1>
      <p class="facts__line">${count} ${count === 1 ? 'item' : 'items'} to buy for ${list.days} days of meals${list.checkedCount ? `, ${list.checkedCount} in the cart` : ''}</p>
      <p class="facts__line facts__line--split">
        <strong>${esc(list.store.name)}</strong>
        <strong>${esc(shortDate(list.start))} to ${esc(shortDate(list.end))}</strong>
      </p>
      <div class="rule rule--thick"></div>
      <p class="facts__amount">${amount}</p>
      <p class="facts__calories${over ? ' is-over' : ''}">
        <span class="facts__calories-label">${over ? ICON.warn : ''}Dollars</span>
        <span class="facts__calories-value">${formatNumber(dollars)}</span>
      </p>
      ${hasBudget ? `
        <div class="meter meter--thick${over ? ' is-over' : ''}" role="img" aria-label="${about}${formatMoney(list.totalCents)} of a ${budgetText(budgetCents)} budget">
          <span style="width:${Math.min(100, Math.max(0, pct))}%"></span>
        </div>` : ''}
      <p class="facts__dv">${hasBudget ? '% of budget' : 'No budget set'}</p>
      <p class="facts__row"><span><strong>Checkout</strong> ${about}${formatMoney(list.totalCents)}${hasBudget ? ` of ${budgetText(budgetCents)}` : ''}</span>${hasBudget ? `<strong>${pct}%</strong>` : ''}</p>
      <p class="facts__row"><span><strong>Eaten in these ${list.days} days</strong> ${about}${formatMoney(list.usedCents)}</span>${hasBudget ? `<strong>${usedPct}%</strong>` : ''}</p>
    </section>`;
}

function groceryControls(fit) {
  const { grocery } = store.state;
  const current = fit.list.store.id;
  const servings = [];
  for (let n = 1; n <= MAX_SERVINGS; n += 1) servings.push(n);
  return `
    <div class="form grocery-controls">
      <div class="field-pair">
        <div class="field">
          <label for="g-store">Shopping at</label>
          <select id="g-store" data-change="grocery-store" data-key="g-store">
            ${shownStores(catalog, grocery.stores, grocery.hidden).map((s) => `<option value="${esc(s.id)}"${s.id === current ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
            <option value="+">Add a store</option>
          </select>
        </div>
        <div class="field">
          <span class="field__label" id="g-budget-label">Budget for this trip</span>
          <button type="button" class="field-btn" data-action="open-budget" data-key="g-budget" aria-describedby="g-budget-label">${grocery.budget ? budgetText(Math.round(grocery.budget * 100)) : 'Set a budget'}</button>
        </div>
      </div>
      <div class="field-pair">
        <div class="field">
          <label for="g-days">Meals for</label>
          <select id="g-days" data-change="grocery-days" data-key="g-days">
            ${DAY_CHOICES.map((n) => `<option value="${n}"${n === grocery.days ? ' selected' : ''}>${n} days</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="g-servings">Each dinner feeds</label>
          <select id="g-servings" data-change="grocery-servings" data-key="g-servings">
            ${servings.map((n) => `<option value="${n}"${n === grocery.servings ? ' selected' : ''}>${n} ${n === 1 ? 'person' : 'people'}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>`;
}

function moveRow(move) {
  const brand = move.kind === 'brand';
  const where = brand ? move.name : `${formatDay(move.date)}, ${lower(SLOT_LABELS[move.slot])}`;
  const to = brand ? move.to || 'The lowest-priced' : move.toName;
  const from = brand ? move.from : lower(move.fromName);
  return `
    <li>
      <span class="moves__where">${esc(where)}</span>
      <strong class="moves__saving">saves ${formatMoney(move.saving)}</strong>
      <span class="moves__what"><strong>${esc(to)}</strong> instead of ${esc(from)}</span>
    </li>`;
}

function budgetCard(fit) {
  const { list, status, overCents, moves, afterCents, budgetCents, shopping } = fit;
  if (status !== 'fits' && status !== 'short') return '';
  const n = moves.length;
  let lead = shopping
    ? 'You have started shopping, so the app only looks for cheaper brands among the items you have left, and none is on record.'
    : 'The app found no cheaper brand, and no cheaper meal that keeps your protein.';
  if (status === 'fits') {
    lead = `${n === 1 ? 'This change brings' : `These ${n} changes bring`} the list to about ${formatMoney(afterCents)}.`;
  } else if (n) {
    lead = `${n === 1 ? 'This change saves' : `These ${n} changes save`} about ${formatMoney(list.totalCents - afterCents)}. That still leaves the list ${formatMoney(afterCents - budgetCents)} over.`;
  }
  const tips = [];
  if (list.keepsCents >= 500) tips.push(`About ${formatMoney(list.keepsCents)} of this list is food that keeps past these ${list.days} days. Mark anything you already have.`);
  if (shopping && status === 'short' && n) tips.push('Meal changes are not suggested once items are in the cart.');
  else if (status === 'short' && !shopping) tips.push('To close the rest, plan fewer days or raise the budget.');
  return `
    <section class="pace pace--warn" aria-labelledby="fit-title">
      <h2 id="fit-title">${ICON.warn}${formatMoney(overCents)} over budget</h2>
      <p>${esc(lead)}</p>
      ${n ? `
        <ul class="moves">
          ${moves.map(moveRow).join('')}
        </ul>
        <button type="button" class="btn btn--primary" data-action="apply-moves" data-key="apply-moves">${n === 1 ? 'Make this change' : `Make these ${n} changes`}</button>` : ''}
      ${tips.length ? `<p class="pace__tip">${esc(tips.join(' '))}</p>` : ''}
    </section>`;
}

function groceryRow(line, list) {
  const notes = [];
  if (line.partly) notes.push(line.from && line.from > list.start ? `What you have lasts until ${formatDay(line.from)}.` : 'You have some at home.');
  if (line.basis === 'elsewhere') notes.push(`Price from ${storeName(line.offer.store)}.`);
  if (line.basis === 'guess') notes.push('No price for this brand yet.');
  const flags = [];
  if (line.nutWord) flags.push(`The name mentions ${line.nutWord}.`);
  if (line.check) flags.push('Check the label.');
  return `
    <li class="buy${line.checked ? ' is-done' : ''}">
      <button type="button" class="buy__open" data-action="open-item" data-item="${esc(line.id)}" data-key="item-${esc(line.id)}">
        <span class="buy__name">${esc(line.name)}</span>
        <span class="buy__qty">${esc(line.quantity)}${line.brand ? `, ${esc(line.brand)}` : ''}</span>
        ${notes.length || flags.length ? `<span class="buy__note">${esc(notes.join(' '))}${flags.length ? ` <strong>${esc(flags.join(' '))}</strong>` : ''}</span>` : ''}
      </button>
      <span class="buy__price${line.estimate ? ' is-estimate' : ''}">${priceHtml(line.cents, line.estimate)}</span>
      <button type="button" class="check${line.checked && freshTick === line.id ? ' is-fresh' : ''}" role="checkbox" aria-checked="${line.checked}" data-action="toggle-item" data-item="${esc(line.id)}" data-key="tick-${esc(line.id)}"
        aria-label="${esc(line.name)}. ${line.checked ? 'In the cart. Tap to take it out.' : 'Tap when it is in the cart.'}">${ICON.check}</button>
    </li>`;
}

/** What should be left of something at home once these meals are cooked, or '' when it is not worth saying. */
function leftText(entry) {
  const { item, left } = entry;
  if (!item.keeps || !(left > 0)) return '';
  const planLeft = (left * entry.planNeed) / entry.need;
  if (item.piece && item.each) {
    const n = Math.floor(planLeft / item.each + 0.1);
    return n >= 1 ? `${n} ${n === 1 ? item.piece[0] : item.piece[1]}` : '';
  }
  return left >= 15 ? amountText(item, left, planLeft) : '';
}

function atHomeSection(list) {
  if (!list.atHome.length) return '';
  return `
    <section class="aisle" aria-labelledby="home-title">
      <div class="rule rule--medium"></div>
      <header class="plan-day__head">
        <h2 id="home-title">Already at home</h2>
        <p>${list.atHome.length} ${list.atHome.length === 1 ? 'item' : 'items'}</p>
      </header>
      <ul class="buys">
        ${list.atHome.map((entry) => {
    const left = leftText(entry);
    return `
          <li class="buy buy--home">
            <button type="button" class="buy__open" data-action="open-item" data-item="${esc(entry.id)}" data-key="item-${esc(entry.id)}">
              <span class="buy__name">${esc(entry.name)}</span>
              <span class="buy__qty">${left ? `About ${esc(left)} left after these meals` : 'Enough for these meals'}</span>
            </button>
            ${ICON.chevron}
          </li>`;
  }).join('')}
      </ul>
    </section>`;
}

function groceryLink() {
  let summary = 'What to buy for these meals';
  if (catalogState === 'ready') {
    const { list } = groceryModel();
    const n = list.lines.length;
    summary = n
      ? `${n} ${n === 1 ? 'item' : 'items'} for ${list.days} days at ${list.store.name}, about ${formatMoney(list.totalCents)}`
      : `Nothing to buy for the next ${list.days} days`;
  }
  return `
    <a class="log-row row-link" href="#/groceries" data-key="open-groceries">
      <span class="log-row__date">Grocery list</span>
      <span class="log-row__nums">${esc(summary)}</span>
      ${ICON.chevron}
    </a>`;
}

function groceriesView() {
  const back = `<a class="back" href="#/plan">${ICON.back}Plan</a>`;
  if (catalogState !== 'ready') {
    return `
      ${back}
      <header class="page-head"><h1>Groceries</h1></header>
      ${catalogState === 'loading' ? '<p class="empty">Getting the price list.</p>' : `
        <p class="notice notice--warn" role="alert">${ICON.warn}<span>The price list did not load. Check your connection and try again.</span></p>
        <button type="button" class="btn btn--primary" data-action="reload-prices" data-key="reload-prices">Try again</button>`}`;
  }
  const fit = groceryModel();
  const { list } = fit;
  const count = list.lines.length;
  const estimates = count - list.recordedCount;

  return `
    ${back}
    ${store.saveFailed ? `<p class="notice notice--warn" role="alert">${ICON.warn}<span>This browser is not saving your changes. Private browsing blocks storage; open the app in a normal window.</span></p>` : ''}
    ${groceryFacts(fit)}
    ${groceryControls(fit)}
    ${budgetCard(fit)}
    <p class="notice">${ICON.warn}<span>The list follows your plan, which has no peanuts or tree nuts. The app cannot read a package, so read the label on anything marked &ldquo;Check the label&rdquo; and on any brand that is new to you.</span></p>
    ${list.numbersOnly.length ? `<p class="hint">${esc(list.numbersOnly.join(', '))} ${list.numbersOnly.length === 1 ? 'is' : 'are'} entered as totals, with no ingredients, so ${list.numbersOnly.length === 1 ? 'it adds' : 'they add'} nothing to this list.</p>` : ''}
    ${list.unmapped.length ? `<p class="notice notice--warn" role="alert">${ICON.warn}<span>The price list has no entry for ${esc(list.unmapped.map((food) => food.replace(/_/g, ' ')).join(', '))}, so ${list.unmapped.length === 1 ? 'it is' : 'they are'} missing from this list. The meals still need ${list.unmapped.length === 1 ? 'it' : 'them'}.</span></p>` : ''}
    ${count ? `
      <div class="btn-pair">
        <button type="button" class="btn" data-action="open-have" data-key="open-have">Mark what I have</button>
        <button type="button" class="btn" data-action="share-list" data-key="share-list">Share the list</button>
      </div>
      ${!store.state.grocery.lots.length && list.keepsCents >= 2000 ? `<p class="hint">A first list stocks the kitchen: about ${formatMoney(list.keepsCents)} of this one is food that keeps past these ${list.days} days. Use &ldquo;Mark what I have&rdquo; for anything already at home.</p>` : ''}
      ${estimates ? `<p class="hint">Prices marked ~ are typical prices, the same for every store. ${estimates === count ? 'Tap an item to enter' : `${list.recordedCount} of ${count} are prices you recorded. Tap an item to enter`} what you pay at ${esc(list.store.name)}.</p>` : ''}
      ${list.groups.map((group, index) => `
        <section class="aisle" aria-labelledby="aisle-${index}">
          <div class="rule rule--medium"></div>
          <header class="plan-day__head">
            <h2 id="aisle-${index}">${esc(group.aisle)}</h2>
            <p>${group.lines.length} ${group.lines.length === 1 ? 'item' : 'items'}, ${group.lines.some((line) => line.estimate) ? 'about ' : ''}${formatMoney(group.cents)}</p>
          </header>
          <ul class="buys">${group.lines.map((line) => groceryRow(line, list)).join('')}</ul>
        </section>`).join('')}` : '<p class="empty">Nothing to buy. Everything these meals need is at home.</p>'}
    ${atHomeSection(list)}
    ${list.seasonings.length ? `<p class="hint">Seasonings these recipes use, not priced: ${esc(list.seasonings.join(', '))}.</p>` : ''}
    <section class="rules" aria-labelledby="grocery-rules">
      <div class="rule rule--medium"></div>
      <h2 id="grocery-rules">How this list is worked out</h2>
      <ul>
        <li>It adds up every ingredient in your planned meals for the days you choose, skips meals you have already logged, and converts recipe amounts to what you buy: raw meat, dry rice, whole cans, fruit with the peel.</li>
        <li>It takes off what you have. Ticking an item, or marking it as at home, records it. Food that keeps (pantry and frozen food, and a few fridge items such as eggs) stays recorded until the planned meals have used it up. Fresh food counts only for the days it was bought for.</li>
        <li>For each item it picks the cheapest way to cover the amount in whole packages. If you choose a brand, it buys that brand.</li>
        <li>A price you record replaces the typical price at that store. Typical prices are U.S. government averages where one exists and estimates for the rest. They are the same for every store, so the list cannot tell you which store is cheaper.</li>
        <li>Over budget, it suggests cheaper brands first, largest saving first, and never a brand you marked to keep. Then it suggests cheaper meals that keep the day within 10 g of its protein. Once something is ticked, it leaves the meals alone.</li>
        <li>The same plan, prices, store, brands and budget always give the same list.</li>
        <li>Typical prices, and which stores appear, can be changed under Settings.</li>
      </ul>
      ${isValidDate(catalog.updated) ? `<p class="form-help">Price list last updated ${esc(formatDay(catalog.updated, { year: true }))}.</p>` : ''}
    </section>`;
}

// ---- grocery sheets

function usesList(uses) {
  const shown = uses.slice(0, 6);
  return `
    <ul class="ingredients">
      ${shown.map((use) => `<li><span>${esc(formatDay(use.date))} ${esc(lower(SLOT_LABELS[use.slot] || use.slot))}: ${esc(use.mealName)}</span><span class="ingredients__g">${formatNumber(use.grams)} g</span></li>`).join('')}
    </ul>
    ${uses.length > shown.length ? `<p class="form-help">And ${uses.length - shown.length} more ${uses.length - shown.length === 1 ? 'meal' : 'meals'}.</p>` : ''}`;
}

function sourceText(line, list) {
  const { offer } = line;
  if (line.basis === 'recorded') return `You recorded it at ${list.store.name}${offer.date ? ` on ${formatDay(offer.date)}` : ''}.`;
  if (line.basis === 'elsewhere') return `You recorded it at ${storeName(offer.store)}. There is no price for it at ${list.store.name} yet.`;
  if (line.basis === 'guess') return `There is no price for ${line.brand} yet, so this is the typical price.`;
  return `${shopCatalog().sources[offer.src] || 'Typical price'}. ${offer.note ? `${offer.note} ` : ''}Not a price from ${list.store.name}.`;
}

function brandOptions(line, list) {
  const { grocery } = store.state;
  const { item } = line;
  const pref = grocery.prefs[item.id] || null;
  const storeKey = (list.store.brand || '').toLowerCase();
  const known = new Map();
  for (const offer of grocery.offers) {
    const key = offer.brand.toLowerCase();
    if (offer.item !== item.id || !key || key === storeKey) continue;
    const entry = known.get(key) || { brand: offer.brand, here: false, priced: true };
    entry.here = entry.here || offer.store === list.store.id;
    known.set(key, entry);
  }
  let current = '';
  if (pref) {
    const key = pref.brand.toLowerCase();
    current = pref.brand === STORE_BRAND || (storeKey && key === storeKey) ? STORE_BRAND : key;
    if (current !== STORE_BRAND && !known.has(key)) known.set(key, { brand: pref.brand, here: false, priced: false });
  }
  const option = (value, isCurrent, name, note) => `
    <li>
      <button type="button" class="option${isCurrent ? ' is-current' : ''}" data-action="set-brand" data-item="${esc(item.id)}" data-brand="${esc(value)}" data-key="brand-${esc(value)}" ${isCurrent ? 'aria-current="true"' : ''}>
        <span class="option__name">${esc(name)}${isCurrent ? '<span class="option__note">Current choice</span>' : ''}</span>
        <span class="option__nums">${esc(note)}</span>
      </button>
    </li>`;
  const brands = [...known.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return `
    <ul class="options">
      ${option('', current === '', 'Lowest price', 'Whatever covers the amount for the least money')}
      ${item.fresh ? '' : option(STORE_BRAND, current === STORE_BRAND, 'Store brand', list.store.brand ? `Usually ${list.store.brand} at ${list.store.name}` : `The ${list.store.name} brand`)}
      ${brands.map(([key, entry]) => {
    const nut = nutWordIn(entry.brand);
    const where = !entry.priced ? 'No price recorded yet' : entry.here ? `Priced at ${list.store.name}` : 'Priced at another store';
    return option(entry.brand, current === key, entry.brand, nut ? `${where}. The name mentions ${nut}; check that it is safe for you.` : where);
  }).join('')}
    </ul>
    ${pref ? `
      <button type="button" class="switch" role="switch" aria-checked="${pref.keep}" data-action="toggle-keep" data-item="${esc(item.id)}" data-key="keep-brand">
        <span>Keep this brand when the list is over budget</span>${ICON.check}
      </button>` : ''}`;
}

function recordedPrices(item) {
  const prices = store.state.grocery.offers
    .filter((offer) => offer.item === item.id)
    .map((offer) => ({ ...offer, storeName: storeName(offer.store) }))
    .sort((a, b) => {
      const [x, y] = [a, b].map((offer) => `${offer.storeName}|${offer.brand}|${offer.unit}`.toLowerCase());
      return (x < y ? -1 : x > y ? 1 : 0) || a.size - b.size || a.price - b.price;
    });
  if (!prices.length) return '';
  return `
    <div class="extras">
      <ul>
        ${prices.map((offer) => {
    const size = offer.unit === PER_LB ? 'per lb' : `${offer.size} ${offer.unit}`;
    const nut = nutWordIn(offer.brand);
    return `
          <li>
            <span class="extras__name">${formatMoney(Math.round(offer.price * 100))}, ${esc(size)}${offer.brand ? `, ${esc(offer.brand)}` : ''}</span>
            <span class="extras__nums">${esc(offer.storeName)}${offer.date ? `, ${esc(formatDay(offer.date))}` : ''}${nut ? `. <strong>The name mentions ${esc(nut)}.</strong>` : ''}</span>
            <button type="button" class="icon-btn" data-action="remove-price" data-id="${esc(offer.id)}" data-item="${esc(item.id)}" aria-label="Remove this price">${ICON.close}</button>
          </li>`;
  }).join('')}
      </ul>
    </div>`;
}

function openItemSheet(itemId, { keepScroll = false } = {}) {
  if (catalogState !== 'ready') return;
  const { list } = groceryModel();
  const item = shopCatalog().itemById.get(itemId);
  const line = list.lines.find((entry) => entry.id === itemId);
  const home = list.atHome.find((entry) => entry.id === itemId);
  if (!item || (!line && !home)) {
    closeSheet();
    return;
  }
  const stock = list.stockGrams.get(itemId) || 0;

  if (!line) {
    const left = leftText(home);
    openSheet(`
      <p class="sheet__context">${esc(item.aisle)}</p>
      <h2 class="sheet__title">${esc(item.name)}</h2>
      <p>Covered by what you have at home${left ? `. About ${esc(left)} should be left after these meals` : ''}.</p>
      <h3>Used in</h3>
      ${usesList(home.uses)}
      <div class="sheet__actions">
        <button type="button" class="btn btn--wide" data-action="out-of-item" data-item="${esc(item.id)}">I have none left</button>
      </div>`, { keepScroll });
    return;
  }

  const { offer } = line;
  // Name the brand you named. Otherwise say "store brand", with the store's main one as a pointer.
  let brandLine = line.brand;
  if (!brandLine && !item.fresh) brandLine = `Store brand${list.store.brand ? `, usually ${list.store.brand} at ${list.store.name}` : ''}`;
  const units = unitsFor(item);
  const unit = units.includes(offer.unit) ? offer.unit : units[0];

  openSheet(`
    <p class="sheet__context">${esc(item.aisle)}, at ${esc(list.store.name)}</p>
    <h2 class="sheet__title">${esc(item.name)}</h2>
    <div class="label label--buy" role="group" aria-label="What to buy">
      <p class="label__title">${esc(line.quantity)}</p>
      ${brandLine ? `<p class="label__line">${esc(brandLine)}</p>` : ''}
      <div class="rule rule--thick"></div>
      <p class="label__calories"><span>Cost</span><span>${priceHtml(line.cents, line.estimate)}</span></p>
      <div class="rule rule--medium"></div>
      <p class="label__row"><span><strong>Price</strong> ${esc(offerPrice(offer))}</span></p>
      <p class="label__row"><span><strong>From</strong> ${esc(sourceText(line, list))}</span></p>
      <p class="label__row"><span><strong>To cover</strong> ${esc(amountText(item, line.grams, line.planGrams))}${item.as ? `, ${esc(item.as)}` : ''}</span></p>
    </div>
    ${item.check ? `<p class="notice">${ICON.warn}<span>Check the label. This kind of packaged food carries nut warnings more often than most.</span></p>` : ''}
    ${line.nutWord ? `<p class="notice notice--warn">${ICON.warn}<span>The name &ldquo;${esc(line.brand)}&rdquo; mentions ${esc(line.nutWord)}. Check that it is safe for you.</span></p>` : ''}

    <h3>Used in</h3>
    ${usesList(line.uses)}

    <h3>Brand to buy</h3>
    ${brandOptions(line, list)}

    <h3>A price you paid</h3>
    ${recordedPrices(item)}
    <form class="form" data-form="add-price" data-item="${esc(item.id)}" novalidate>
      <div class="field">
        <label for="p-brand">Brand</label>
        <input id="p-brand" name="brand" type="text" maxlength="60" autocomplete="off" autocapitalize="words" placeholder="${item.fresh ? 'Optional' : esc(list.store.brand || 'Store brand')}" data-key="p-brand">
      </div>
      <div class="field-pair">
        <div class="field"><label for="p-size">Package size</label><input id="p-size" name="size" type="number" inputmode="decimal" min="0" step="any" data-key="p-size"></div>
        <div class="field">
          <label for="p-unit">Unit</label>
          <select id="p-unit" name="unit" data-key="p-unit">
            ${units.map((u) => `<option value="${esc(u)}"${u === unit ? ' selected' : ''}>${esc(u === PER_LB ? 'sold per lb' : u)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label for="p-price">Price, $</label><input id="p-price" name="price" type="number" inputmode="decimal" min="0" step="0.01" data-key="p-price"></div>
      <p class="form-help">Saved for ${esc(list.store.name)}. ${item.fresh ? 'Leave the brand empty unless you buy a particular one.' : 'Leave the brand empty for the store brand.'} For food sold by the pound, leave the size empty. To choose a brand before you know its price, fill in the brand alone.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide" data-key="save-price">Save</button>
    </form>

    <div class="sheet__actions">
      ${stock > 0 ? `<p>The app counts about ${esc(amountText(item, stock, (stock * line.planGrams) / line.grams))} of this at home, so the list covers the rest.</p>` : ''}
      <button type="button" class="btn btn--wide" data-action="have-item" data-item="${esc(item.id)}">I already have this</button>
      ${stock > 0 ? `<button type="button" class="btn btn--wide" data-action="out-of-item" data-item="${esc(item.id)}">I have none left</button>` : ''}
    </div>`, { keepScroll });
}

function openHaveSheet({ keepScroll = false } = {}) {
  const { list } = groceryModel();
  const rows = [
    ...list.lines.map((line) => ({ id: line.id, name: line.name, aisle: line.aisle, have: false, note: `${line.quantity}, ${line.estimate ? 'about ' : ''}${formatMoney(line.cents)}` })),
    ...list.atHome.map((entry) => ({ id: entry.id, name: entry.name, aisle: entry.aisle, have: true, note: 'At home' })),
  ].sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  openSheet(`
    <h2 class="sheet__title">What is at home?</h2>
    <p>Tick what is already in your kitchen. The app assumes a full package. Food that keeps stays ticked until the planned meals have used it up; fresh food counts for this list only.</p>
    <ul class="options">
      ${rows.map((row) => `
        <li>
          <button type="button" class="option option--tick" role="checkbox" aria-checked="${row.have}" data-action="toggle-have" data-item="${esc(row.id)}" data-key="have-${esc(row.id)}">
            <span class="option__name">${esc(row.name)}</span>
            <span class="option__nums">${esc(row.note)}</span>
            ${ICON.check}
          </button>
        </li>`).join('')}
    </ul>
    <button type="button" class="btn btn--primary btn--wide" data-action="close-sheet">Done</button>`, { keepScroll });
}

function openBudgetSheet() {
  const { budget } = store.state.grocery;
  openSheet(`
    <h2 class="sheet__title">Budget for this trip</h2>
    <p>What you want to spend on this list. When the list comes to more, the app works out which changes bring it under.</p>
    <form class="form" data-form="budget" novalidate>
      <div class="field"><label for="b-amount">Budget, $</label><input id="b-amount" name="budget" type="number" inputmode="decimal" min="1" max="5000" step="1" value="${budget ?? ''}" required></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide">Save</button>
      ${budget ? '<button type="button" class="btn btn--wide" data-action="clear-budget">Shop without a budget</button>' : ''}
    </form>`);
  const input = sheet.querySelector('#b-amount');
  if (input && !matchMedia('(pointer: coarse)').matches) input.focus();
}

function openStoreSheet() {
  const { stores } = store.state.grocery;
  openSheet(`
    <h2 class="sheet__title">Add a store</h2>
    <p>For a store that is not in the list. Prices you record there are kept with it.</p>
    <form class="form" data-form="add-store" novalidate>
      <div class="field"><label for="st-name">Store name</label><input id="st-name" name="name" type="text" maxlength="40" autocomplete="off" autocapitalize="words" required></div>
      <div class="field">
        <label for="st-brand">Its own brand, optional</label>
        <input id="st-brand" name="brand" type="text" maxlength="40" autocomplete="off" autocapitalize="words">
        <p class="form-help">The name on the store&rsquo;s own products, if it has one.</p>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide">Add the store</button>
    </form>
    ${stores.length ? `
      <h3>Stores you added</h3>
      <div class="extras">
        <ul>
          ${stores.map((s) => `
            <li>
              <span class="extras__name">${esc(s.name)}</span>
              <span class="extras__nums">${s.brand ? esc(s.brand) : 'No brand of its own'}</span>
              <button type="button" class="icon-btn" data-action="remove-store" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)} and the prices recorded there">${ICON.close}</button>
            </li>`).join('')}
        </ul>
      </div>` : ''}`);
  const input = sheet.querySelector('#st-name');
  if (input && !matchMedia('(pointer: coarse)').matches) input.focus();
}

/** A purchase record for a line of the list: what ticking it, or having it, adds to stock. */
function lotFor(line, list, home) {
  return {
    item: line.id,
    date: list.start,
    grams: Math.round(line.covers * 100) / 100,
    until: line.item.keeps ? null : list.end,
    home,
    skip: loggedSince(list.start)[list.start] || [],
  };
}

function markAtHome(itemId) {
  const { list } = groceryModel();
  const line = list.lines.find((entry) => entry.id === itemId);
  if (!line) return false;
  store.batch(() => {
    // "At home" replaces "in the cart", so the same food is not counted twice tomorrow.
    store.removeGroceryLots((lot) => lot.item === itemId && lot.date === list.start && !lot.home);
    store.addGroceryLot(lotFor(line, list, true), list.start);
  });
  return true;
}

async function shareList() {
  const body = listAsText(groceryModel().list);
  if (matchMedia('(pointer: coarse)').matches && navigator.share) {
    try {
      await navigator.share({ title: 'Grocery list', text: body });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(body);
    toast('List copied');
  } catch {
    toast('This browser would not copy the list');
  }
}

// ------------------------------------------------------------------ changes made in the app
// Meal times, meals, the two-week menu, typical prices, stores and reminders,
// all changed from Settings. The changes are saved by store.js and laid over
// the built-in plan before every draw.

const SETTINGS_PAGES = {
  times: 'Meal times',
  meals: 'Meals',
  menu: 'Two-week menu',
  reminders: 'Meal reminders',
  prices: 'Grocery prices',
  stores: 'Stores',
};
const TIME_SLOTS = ['breakfast', 'morningSnack', 'lunch', 'snack', 'dinner'];
const KIND_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const KIND_PLURALS = { breakfast: 'Breakfasts', lunch: 'Lunches', dinner: 'Dinners', snack: 'Snacks' };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let appliedCustom = null;

/** Lay the saved meal times, meals and menu over the built-in plan. */
function applyCustom() {
  const { custom } = store.state;
  if (custom === appliedCustom) return;
  appliedCustom = custom;
  setMealTimes(custom.times);
  applyMealChanges({ ...custom.meals, menu: custom.menu });
}

const backToSettings = () => `<a class="back" href="#/settings">${ICON.back}Settings</a>`;

/** The meal slots that come up at all in the next two weeks. */
function slotsInPlan() {
  const { settings, swaps } = store.state;
  const today = todayStr();
  const slots = new Set();
  for (let i = 0; i < 14; i += 1) {
    const date = addDays(today, i);
    for (const { slot } of planForDate(date, targetFor(settings, date).kcal, swaps[date] || {}).slots) slots.add(slot);
  }
  return slots;
}

/** The text of a meal that a person typed or changed, checked for nut words. */
function mealNutWord(meal) {
  return nutWordIn(`${meal.name} ${meal.method || ''} ${meal.items.map(ingredientText).join(' ')}`);
}

const nutNotice = (word, what = 'This meal') => `
  <p class="notice notice--warn">${ICON.warn}<span>${esc(what)} mentions &ldquo;${esc(word)}&rdquo;, which is on Fuel&rsquo;s list of nut words. Your plan is nut-free, so make sure it is safe for you.</span></p>`;

// ---- the hub

function timesSummary() {
  const present = slotsInPlan();
  return orderedSlots().filter((slot) => present.has(slot)).map((slot) => formatTime(getMealTimes()[slot])).join(', ');
}

function mealsSummary() {
  const changed = MEALS.filter((meal) => meal.origin === 'changed').length;
  const yours = MEALS.filter((meal) => meal.origin === 'yours').length;
  const parts = [`${MEALS.length} meals`];
  if (changed) parts.push(`${changed} changed`);
  if (yours) parts.push(`${yours} of your own`);
  return parts.join(', ');
}

function menuChanges() {
  let changed = 0;
  ROTATION.forEach((day, i) => {
    for (const slot of MAIN_SLOTS) if (day[slot] !== BASE_ROTATION[i][slot]) changed += 1;
  });
  return changed;
}

function hubRow(page, summary, strong = false) {
  return `
    <a class="log-row" href="#/settings/${page}" data-key="hub-${page}">
      <span class="log-row__date">${esc(SETTINGS_PAGES[page])}</span>
      <span class="log-row__nums">${strong ? `<strong>${esc(summary)}</strong>` : esc(summary)}</span>
      ${ICON.chevron}
    </a>`;
}

function hubRows() {
  const { grocery } = store.state;
  const status = reminderStatus();
  const reminderText = { off: 'Not set up', ready: 'Ready to update', stale: 'Needs an update', current: 'Up to date' }[status.state];
  const menuChanged = menuChanges();
  const typicalChanged = Object.keys(grocery.typical).length;
  let storesText = grocery.hidden.length ? `${grocery.hidden.length} hidden` : 'All shown';
  if (catalogState === 'ready') {
    const all = allStores(catalog, grocery.stores).length;
    const shown = shownStores(catalog, grocery.stores, grocery.hidden).length;
    storesText = shown === all ? `All ${all} shown` : `${shown} of ${all} shown`;
  }
  return `
    <section aria-labelledby="set-meals">
      <div class="rule rule--medium"></div>
      <h2 id="set-meals">Meals and reminders</h2>
      <nav class="rows" aria-labelledby="set-meals">
        ${hubRow('times', timesSummary())}
        ${hubRow('meals', mealsSummary())}
        ${hubRow('menu', menuChanged ? `${menuChanged} ${menuChanged === 1 ? 'meal' : 'meals'} changed from the original` : 'The original menu')}
        ${hubRow('reminders', reminderText, status.state === 'stale')}
      </nav>
    </section>
    <section aria-labelledby="set-groceries">
      <div class="rule rule--medium"></div>
      <h2 id="set-groceries">Groceries</h2>
      <nav class="rows" aria-labelledby="set-groceries">
        ${hubRow('prices', typicalChanged ? `${typicalChanged} typical ${typicalChanged === 1 ? 'price' : 'prices'} changed` : 'Typical prices from the price list')}
        ${hubRow('stores', storesText)}
      </nav>
    </section>`;
}

function settingsPage(page) {
  if (page === 'times') return timesPage();
  if (page === 'meals') return mealsPage();
  if (page === 'menu') return menuPage();
  if (page === 'reminders') return remindersPage();
  if (page === 'prices') return pricesPage();
  return storesPage();
}

// ---- meal times

function timesPage() {
  const times = getMealTimes();
  const present = slotsInPlan();
  const changed = TIME_SLOTS.some((slot) => times[slot] !== CONFIG.mealTimes[slot]);
  const field = (slot) => `
    <div class="field">
      <label for="t-${slot}">${SLOT_LABELS[slot]}</label>
      <input id="t-${slot}" name="${slot}" type="time" value="${times[slot]}" required data-key="t-${slot}">
    </div>`;
  const status = reminderStatus();
  return `
    ${backToSettings()}
    <header class="page-head">
      <h1>Meal times</h1>
      <p>When you eat each meal. Today, the plan and the reminders all follow these times.</p>
    </header>
    <form class="form" data-form="times" novalidate>
      <div class="field-pair">${field('breakfast')}${field('lunch')}</div>
      <div class="field-pair">${field('snack')}${field('dinner')}</div>
      ${field('morningSnack')}
      <p class="form-help">${present.has('morningSnack')
    ? 'Your plan has a morning snack on some days.'
    : 'A morning snack only comes up at about 2,000 kcal a day and more, so your plan has none right now.'}</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        <button class="btn btn--primary" data-key="save-times">Save meal times</button>
        ${changed ? '<button type="button" class="btn" data-action="reset-times" data-key="reset-times">Use the original times</button>' : ''}
      </div>
    </form>
    ${status.state === 'stale' ? `<p class="notice notice--warn">${ICON.warn}<span>Your calendar reminders still have the old times. <a href="#/settings/reminders">Update them</a> to move the alerts too.</span></p>` : ''}`;
}

// ---- meals

function libraryRow(meal) {
  const notes = [`${formatNumber(meal.kcal)} kcal, ${meal.protein} g protein`];
  if (meal.origin === 'changed') notes.push('changed');
  if (meal.origin === 'yours') notes.push(meal.numbersOnly ? 'yours, entered as totals' : 'yours');
  if (meal.slot === 'snack' && meal.manualOnly) notes.push('not picked by itself');
  const nut = mealNutWord(meal);
  return `
    <button type="button" class="log-row" data-action="view-meal" data-meal="${esc(meal.id)}" data-key="meal-${esc(meal.id)}">
      <span class="log-row__date">${esc(meal.name)}</span>
      <span class="log-row__nums">${esc(notes.join(', '))}${nut ? ` <strong>Mentions ${esc(nut)}.</strong>` : ''}</span>
      ${ICON.chevron}
    </button>`;
}

function mealsPage() {
  return `
    ${backToSettings()}
    <header class="page-head">
      <h1>Meals</h1>
      <p>Tap a meal to change its amounts, its name or how to make it. The plan, the grocery list and the reminders all use your version, and any meal can be put back.</p>
    </header>
    <button type="button" class="btn btn--primary btn--wide" data-action="new-meal" data-key="new-meal">Add a meal of your own</button>
    ${SLOTS.map((slot) => {
    const meals = mealsForSlot(slot);
    return `
      <section class="aisle" aria-labelledby="meals-${slot}">
        <div class="rule rule--medium"></div>
        <header class="plan-day__head"><h2 id="meals-${slot}">${KIND_PLURALS[slot]}</h2><p>${meals.length}</p></header>
        <div class="rows">${meals.map(libraryRow).join('')}</div>
      </section>`;
  }).join('')}
    <p class="hint">Snacks are not in the menu: each day the plan picks the snack that best fills the calories the meals leave. Open a snack to keep it out of those picks.</p>`;
}

function recipeHtml(meal) {
  const method = meal.method ? `<h3>How to make it</h3><p class="method">${esc(meal.method)}</p>` : '';
  if (meal.numbersOnly) return `<p class="form-help">Entered as totals, so there are no ingredients to list or to buy.</p>${method}`;
  return `
    <h3>What goes in</h3>
    <ul class="ingredients">
      ${meal.items.map((item) => `<li><span>${esc(ingredientText(item))}</span><span class="ingredients__g">${gramsText(item[1])} g</span></li>`).join('')}
    </ul>
    ${method}`;
}

function openMealInfo(id, { keepScroll = false } = {}) {
  const meal = mealById(id);
  if (!meal) {
    closeSheet();
    return;
  }
  const base = baseMeal(id);
  let context = KIND_LABELS[meal.slot];
  if (meal.origin === 'changed') context += ', your version';
  if (meal.origin === 'yours') context += ', one of yours';
  const nut = mealNutWord(meal);
  openSheet(`
    <p class="sheet__context">${esc(context)}</p>
    <h2 class="sheet__title">${esc(meal.name)}</h2>
    ${nut ? nutNotice(nut) : ''}
    ${nutritionLabel(meal)}
    ${recipeHtml(meal)}
    ${meal.slot === 'snack' ? `
      <button type="button" class="switch" role="switch" aria-checked="${!meal.manualOnly}" data-action="toggle-snack-auto" data-meal="${esc(id)}" data-key="snack-auto">
        <span>Let the plan pick it to fill a day<small>Off: it is only used when you choose it.</small></span>${ICON.check}
      </button>` : ''}
    <div class="sheet__actions">
      <button type="button" class="btn btn--primary btn--wide" data-action="edit-meal" data-meal="${esc(id)}" data-key="edit-meal">Change this meal</button>
      ${meal.origin === 'changed' ? `<button type="button" class="btn btn--wide" data-action="reset-meal" data-meal="${esc(id)}">Put back the original, ${formatNumber(base.kcal)} kcal</button>` : ''}
      ${meal.origin === 'yours' ? `<button type="button" class="btn btn--danger btn--wide" data-action="confirm-delete-meal" data-meal="${esc(id)}">Delete this meal</button>` : ''}
    </div>`, { keepScroll });
}

function openDeleteMealSheet(id) {
  const meal = mealById(id);
  if (!meal) return;
  const inMenu = ROTATION.some((day) => Object.values(day).includes(id));
  openSheet(`
    <h2 class="sheet__title">Delete ${esc(meal.name)}?</h2>
    <p>${inMenu ? 'It also comes out of the two-week menu, and the original meal goes back in. ' : ''}Days you have already logged keep it.</p>
    <div class="sheet__actions">
      <button type="button" class="btn btn--danger btn--wide" data-action="delete-meal" data-meal="${esc(id)}">Delete the meal</button>
      <button type="button" class="btn btn--wide" data-action="view-meal" data-meal="${esc(id)}">Keep it</button>
    </div>`);
}

// ---- the meal editor
// Edits a draft, so moving to the food list and back loses nothing. Nothing
// is saved until Save.

let draft = null;
const EMPTY_FACTS = { kcal: '', protein: '', carbs: '', fat: '' };

function startDraft(id) {
  if (!id) return { id: null, slot: 'dinner', name: '', mode: 'items', items: [], facts: { ...EMPTY_FACTS }, method: '', nutOk: false };
  const meal = mealById(id);
  return {
    id,
    slot: meal.slot,
    name: meal.name,
    mode: meal.numbersOnly ? 'facts' : 'items',
    items: meal.items.map(([food, grams, how]) => ({ food, grams: gramsText(grams), how, was: grams })),
    facts: meal.numbersOnly
      ? { kcal: String(meal.kcal), protein: String(meal.protein), carbs: String(meal.carbs), fat: String(meal.fat) }
      : { ...EMPTY_FACTS },
    method: meal.method || '',
    nutOk: false,
  };
}

function draftNumbers(d) {
  if (d.mode === 'facts') {
    const n = (key) => (Number(d.facts[key]) >= 0 ? Math.round(Number(d.facts[key])) : 0);
    return { kcal: n('kcal'), protein: n('protein'), carbs: n('carbs'), fat: n('fat') };
  }
  return nutritionFor(d.items.map(({ food, grams }) => [food, Number(grams)]).filter(([, g]) => g > 0 && g <= MAX_GRAMS));
}

function draftLabel(d) {
  const n = draftNumbers(d);
  const base = d.id ? baseMeal(d.id) : null;
  const was = base && (n.kcal !== base.kcal || n.protein !== base.protein) ? `<p class="label__line">The original: ${formatNumber(base.kcal)} kcal, ${base.protein} g protein</p>` : '';
  return `
    <div class="label label--live" role="group" aria-label="What this meal comes to">
      <p class="label__calories"><span>Calories</span><span>${formatNumber(n.kcal)}</span></p>
      <div class="rule rule--medium"></div>
      <p class="label__row label__row--split">
        <span><strong>Protein</strong> ${n.protein} g</span>
        <span><strong>Carbs</strong> ${n.carbs} g</span>
        <span><strong>Fat</strong> ${n.fat} g</span>
      </p>
      ${was}
    </div>`;
}

function draftWarning(d) {
  const word = nutWordIn(`${d.name} ${d.method}`);
  return word ? nutNotice(word) : '';
}

function itemNote(item) {
  const g = Number(item.grams);
  if (item.was !== null && item.was !== undefined && Math.abs(g - item.was) > 0.05) {
    return `Was ${gramsText(item.was)} g${item.how ? `: ${esc(item.how)}` : ''}`;
  }
  return item.how ? esc(item.how) : '';
}

function itemsEditor(d) {
  const name = (food) => FOOD_NAMES[food] || food;
  return `
    <fieldset class="edit-items">
      <legend>Ingredients, in grams</legend>
      ${d.items.length ? `
        <ul>
          ${d.items.map((item, i) => `
            <li>
              <span class="edit-items__name">${esc(name(item.food))}<small id="note-${i}">${itemNote(item)}</small></span>
              <span class="edit-items__amount">
                <input type="number" inputmode="decimal" min="0" max="${MAX_GRAMS}" step="any" value="${esc(item.grams)}" data-input="draft-grams" data-index="${i}" data-key="grams-${i}" aria-label="${esc(name(item.food))}, grams">
                <span aria-hidden="true">g</span>
              </span>
              <button type="button" class="icon-btn" data-action="draft-remove" data-index="${i}" data-key="remove-${i}" aria-label="Remove ${esc(name(item.food))}">${ICON.close}</button>
            </li>`).join('')}
        </ul>` : '<p class="form-help">No ingredients yet.</p>'}
      <div class="edit-items__tools">
        <button type="button" class="btn" data-action="draft-add-food" data-key="add-ingredient">Add an ingredient</button>
        ${d.items.length ? `
          <div class="btn-pair" role="group" aria-label="Every amount at once">
            <button type="button" class="btn" data-action="draft-scale" data-factor="0.9" data-key="scale-down">All 10% less</button>
            <button type="button" class="btn" data-action="draft-scale" data-factor="1.1" data-key="scale-up">All 10% more</button>
          </div>` : ''}
      </div>
    </fieldset>`;
}

function factsEditor(d) {
  const field = (key, label, max) => `
    <div class="field">
      <label for="m-${key}">${label}</label>
      <input id="m-${key}" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="${esc(d.facts[key])}" data-input="draft-fact" data-fact="${key}" data-key="m-${key}"${key === 'kcal' ? ' required' : ''}>
    </div>`;
  return `
    <div class="field-pair">${field('kcal', 'Calories', 4000)}${field('protein', 'Protein, g', 400)}</div>
    <div class="field-pair">${field('carbs', 'Carbs, g', 600)}${field('fat', 'Fat, g', 300)}</div>
    <p class="form-help">Totals from a menu or a label. With no ingredients, this meal adds nothing to the grocery list.</p>`;
}

function openMealEditor({ keepScroll = false, focus = null } = {}) {
  const d = draft;
  const isNew = !d.id;
  openSheet(`
    <p class="sheet__context">${isNew ? 'A meal of your own' : esc(KIND_LABELS[d.slot])}</p>
    <h2 class="sheet__title">${isNew ? 'Add a meal' : 'Change this meal'}</h2>
    <div id="draft-facts" aria-live="polite">${draftLabel(d)}</div>
    <form class="form" data-form="meal" novalidate>
      ${isNew ? `
        <div class="field">
          <label for="m-slot">Meal</label>
          <select id="m-slot" name="slot" data-input="draft-slot" data-key="m-slot">
            ${SLOTS.map((slot) => `<option value="${slot}"${slot === d.slot ? ' selected' : ''}>${KIND_LABELS[slot]}</option>`).join('')}
          </select>
        </div>
        <div class="segmented" role="radiogroup" aria-label="How to enter it">
          <button type="button" role="radio" aria-checked="${d.mode === 'items'}" data-action="draft-mode" data-mode="items" data-key="mode-items">From ingredients</button>
          <button type="button" role="radio" aria-checked="${d.mode === 'facts'}" data-action="draft-mode" data-mode="facts" data-key="mode-facts">From totals</button>
        </div>` : ''}
      <div class="field">
        <label for="m-name">Name</label>
        <input id="m-name" name="name" type="text" maxlength="${NAME_MAX}" value="${esc(d.name)}" autocomplete="off" autocapitalize="sentences" data-input="draft-name" data-key="m-name" required>
      </div>
      ${d.mode === 'items' ? itemsEditor(d) : factsEditor(d)}
      <div class="field">
        <label for="m-method">How to make it${d.mode === 'facts' ? ', if you like' : ''}</label>
        <textarea id="m-method" name="method" rows="4" maxlength="${METHOD_MAX}" data-input="draft-method" data-key="m-method">${esc(d.method)}</textarea>
      </div>
      <div id="draft-warn">${draftWarning(d)}</div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide" data-key="save-meal">${d.nutOk ? 'Save anyway' : isNew ? 'Add this meal' : 'Save this meal'}</button>
    </form>`, { keepScroll });
  if (focus) {
    const target = sheet.querySelector(focus);
    if (target) {
      target.focus();
      if (target.select) target.select();
    }
  }
}

/** Update the numbers and warnings as you type, without redrawing the form. */
function refreshDraft(index) {
  if (!draft || !sheet.open) return;
  const facts = sheet.querySelector('#draft-facts');
  if (facts) facts.innerHTML = draftLabel(draft);
  const warn = sheet.querySelector('#draft-warn');
  if (warn) warn.innerHTML = draftWarning(draft);
  if (index !== undefined) {
    const note = sheet.querySelector(`#note-${index}`);
    if (note) note.innerHTML = itemNote(draft.items[index]);
  }
  const save = sheet.querySelector('[data-key="save-meal"]');
  if (save && !draft.nutOk) save.textContent = draft.id ? 'Save this meal' : 'Add this meal';
}

function openFoodPicker() {
  const foods = Object.keys(FOODS).sort((a, b) => FOOD_NAMES[a].localeCompare(FOOD_NAMES[b]));
  openSheet(`
    <p class="sheet__context">${esc(draft.name || (draft.id ? 'This meal' : 'Your meal'))}</p>
    <h2 class="sheet__title">Add an ingredient</h2>
    <div class="field">
      <label for="food-search">Find a food</label>
      <input id="food-search" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="For example, rice" data-input="food-search" data-key="food-search">
    </div>
    <ul class="options" id="food-options">
      ${foods.map((food) => `
        <li data-name="${esc(FOOD_NAMES[food].toLowerCase())}">
          <button type="button" class="option" data-action="draft-pick-food" data-food="${food}">
            <span class="option__name">${esc(FOOD_NAMES[food])}</span>
            <span class="option__nums">${formatNumber(FOODS[food][0])} kcal and ${FOODS[food][1]} g protein per 100 g</span>
          </button>
        </li>`).join('')}
    </ul>
    <p class="form-help" id="food-none" hidden>No food matches. For anything not on this list of ${foods.length}, add the meal as totals instead.</p>
    <button type="button" class="btn btn--wide" data-action="draft-back">Back to the meal</button>`);
}

function filterFoods(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const item of sheet.querySelectorAll('#food-options li')) {
    const match = words.every((word) => item.dataset.name.includes(word));
    item.hidden = !match;
    if (match) shown += 1;
  }
  const none = sheet.querySelector('#food-none');
  if (none) none.hidden = shown > 0;
}

// ---- the two-week menu

/** Which week of the two is this one, and the Monday each of them starts next. */
function menuWeeks() {
  const today = todayStr();
  const monday = addDays(today, -weekdayIndex(today));
  const thisWeek = rotationIndex(today) < 7 ? 'A' : 'B';
  const otherWeek = thisWeek === 'A' ? 'B' : 'A';
  return { today, thisWeek, start: { [thisWeek]: monday, [otherWeek]: addDays(monday, 7) } };
}

/** The next date (today or later) a cell of the menu falls on. */
function nextDateFor(index) {
  const { today, start } = menuWeeks();
  const date = addDays(start[index < 7 ? 'A' : 'B'], index % 7);
  return date < today ? addDays(date, 14) : date;
}

const shortRange = (start) => `${monthName(Number(start.slice(5, 7)) - 1)} ${Number(start.slice(8, 10))} to ${formatDay(addDays(start, 6)).replace(/^\w+, /, '')}`;

function menuDay(index, date) {
  const day = ROTATION[index];
  const meals = MAIN_SLOTS.map((slot) => mealById(day[slot]));
  const kcal = meals.reduce((sum, meal) => sum + meal.kcal, 0);
  const target = targetFor(store.state.settings, date).kcal;
  return `
    <div class="menu-day">
      <header class="plan-day__head"><h3>${DAY_NAMES[index % 7]}</h3><p>${formatNumber(kcal)} kcal before snacks</p></header>
      ${kcal > target ? `<p class="menu-day__over">${ICON.warn}Over your ${formatNumber(target)} kcal target before any snack</p>` : ''}
      <div class="rows">
        ${MAIN_SLOTS.map((slot, k) => {
    const meal = meals[k];
    const changed = meal.id !== BASE_ROTATION[index][slot];
    return `
          <button type="button" class="log-row" data-action="menu-cell" data-index="${index}" data-slot="${slot}" data-key="cell-${index}-${slot}">
            <span class="log-row__date">${esc(meal.name)}</span>
            <span class="log-row__nums">${SLOT_LABELS[slot]}, ${formatNumber(meal.kcal)} kcal${changed ? ', <strong>changed</strong>' : ''}</span>
            ${ICON.chevron}
          </button>`;
  }).join('')}
      </div>
    </div>`;
}

function menuPage() {
  const { thisWeek, start } = menuWeeks();
  const changed = menuChanges();
  return `
    ${backToSettings()}
    <header class="page-head">
      <h1>Two-week menu</h1>
      <p>The breakfast, lunch and dinner for each day. The menu repeats every two weeks; this is week ${thisWeek}. Snacks are picked each day to fill what the meals leave.</p>
    </header>
    ${changed ? `<button type="button" class="btn" data-action="confirm-reset-menu" data-key="reset-menu">Go back to the original menu</button>` : ''}
    ${['A', 'B'].map((week) => `
      <section aria-labelledby="week-${week}">
        <div class="rule rule--thick"></div>
        <h2 class="menu-week" id="week-${week}">Week ${week}<span>${week === thisWeek ? 'This week' : 'Next week'}, ${esc(shortRange(start[week]))}</span></h2>
        ${DAY_NAMES.map((name, i) => menuDay((week === 'A' ? 0 : 7) + i, addDays(start[week], i))).join('')}
      </section>`).join('')}`;
}

function openMenuCell(index, slot) {
  const currentId = ROTATION[index][slot];
  const originalId = BASE_ROTATION[index][slot];
  const dayName = DAY_NAMES[index % 7];
  openSheet(`
    <p class="sheet__context">Week ${index < 7 ? 'A' : 'B'}, ${dayName}</p>
    <h2 class="sheet__title">Choose the ${esc(lower(SLOT_LABELS[slot]))}</h2>
    <p>For every other ${dayName}, next on ${esc(formatDay(nextDateFor(index)))}. To change a single day, use Swap on the Plan tab instead.</p>
    <ul class="options">
      ${mealsForSlot(slot).map((meal) => {
    const current = meal.id === currentId;
    let note = current ? 'Current choice' : '';
    if (meal.id === originalId && !current) note = 'The original';
    return `
        <li>
          <button type="button" class="option${current ? ' is-current' : ''}" data-action="choose-menu" data-index="${index}" data-slot="${slot}" data-meal="${esc(meal.id)}" ${current ? 'aria-current="true"' : ''}>
            <span class="option__name">${esc(meal.name)}${note ? `<span class="option__note">${note}</span>` : ''}</span>
            <span class="option__nums">${formatNumber(meal.kcal)} kcal, ${meal.protein} g protein</span>
          </button>
        </li>`;
  }).join('')}
    </ul>`);
}

// ---- reminders

let remindersMemo = { key: null, plan: null };
let publishing = false;
let publishError = null; // what went wrong the last time, shown until the next try

/** What the reminders would be made from today: target, times, end date and fingerprint. */
function remindersPlan() {
  const { settings } = store.state;
  const today = todayStr();
  const kcal = targetFor(settings, today).kcal;
  const soonest = addDays(today, 27);
  const until = settings.targetDate > soonest ? settings.targetDate : soonest;
  const times = getMealTimes();
  const key = JSON.stringify([mealsVersion(), times, kcal, until]);
  if (remindersMemo.key !== key) {
    remindersMemo = { key, plan: { today, kcal, until, times, signature: remindersSignature({ kcalTarget: kcal, mealTimes: times, untilDate: until }) } };
  }
  return { ...remindersMemo.plan, today };
}

function reminderStatus() {
  const key = keyStore.get();
  const plan = remindersPlan();
  const { published } = store.state.reminders;
  let state = 'stale';
  if (!key) state = 'off';
  else if (!published) state = 'ready';
  else if (published.signature === plan.signature) state = 'current';
  return { state, key, plan, published };
}

function staleReasons(published, plan) {
  const reasons = [];
  const present = slotsInPlan();
  for (const slot of orderedSlots(plan.times)) {
    if (present.has(slot) && published.times[slot] !== plan.times[slot]) {
      reasons.push(`${SLOT_LABELS[slot]} is at ${formatTime(plan.times[slot])} now, not ${formatTime(published.times[slot])}.`);
    }
  }
  if (published.kcal !== null && published.kcal !== plan.kcal) {
    reasons.push(`Daily calories are ${formatNumber(plan.kcal)} now, not ${formatNumber(published.kcal)}, so some snacks differ.`);
  }
  if (published.until && published.until !== plan.until) reasons.push(`The reminders should now run until ${formatDay(plan.until, { year: true })}.`);
  if (!reasons.length) reasons.push('Meals or the two-week menu changed.');
  return reasons;
}

function reminderPanel(status) {
  const { state, key, plan, published } = status;
  const update = `<button type="button" class="btn btn--primary" data-action="update-reminders" data-key="update-reminders"${publishing ? ' disabled' : ''}>${publishing ? 'Updating' : 'Update the calendar file'}</button>`;
  const error = publishError ? `<p class="notice notice--warn" role="alert">${ICON.warn}<span>${esc(publishError)}</span></p>` : '';
  if (state === 'off') {
    return `
      <section class="pace" aria-labelledby="rem-status">
        <h2 id="rem-status">Not connected to GitHub</h2>
        <p>Fuel needs a GitHub key to update the calendar file on your site. Until then, the file has the original meal times and menu.</p>
        <button type="button" class="btn btn--primary" data-action="open-connect" data-key="open-connect">Connect to GitHub</button>
      </section>`;
  }
  if (state === 'ready') {
    return `
      <section class="pace" aria-labelledby="rem-status">
        <h2 id="rem-status">Ready to update</h2>
        <p>Connected to ${esc(key.owner)}/${esc(key.repo)}. The calendar file on your site still has the original meal times and menu.</p>
        ${error}${update}
      </section>`;
  }
  if (state === 'stale') {
    return `
      <section class="pace pace--warn" aria-labelledby="rem-status">
        <h2 id="rem-status">${ICON.warn}Needs an update</h2>
        <p>Your plan changed since the calendar file was last updated:</p>
        <ul class="reasons">${staleReasons(published, plan).map((reason) => `<li>${esc(reason)}</li>`).join('')}</ul>
        ${error}${update}
      </section>`;
  }
  const at = new Date(published.at);
  const when = `${formatDay(todayStr(at))}, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return `
    <section class="pace pace--ok" aria-labelledby="rem-status">
      <h2 id="rem-status">${ICON.check}Up to date</h2>
      <p>The calendar file on your site matches your plan. Last updated ${esc(when)}.</p>
      ${error}
    </section>`;
}

function remindersPage() {
  const status = reminderStatus();
  const { plan, key } = status;
  const urls = calendarUrls(location.href);
  const present = slotsInPlan();
  const times = orderedSlots(plan.times).filter((slot) => present.has(slot));
  return `
    ${backToSettings()}
    <header class="page-head">
      <h1>Meal reminders</h1>
      <p>Calendar alerts you at each meal time and names the meal. It reads them from a calendar file on your site, which Fuel rewrites when your plan changes.</p>
    </header>
    ${reminderPanel(status)}
    <dl class="times">
      ${times.map((slot) => `<div><dt>${SLOT_LABELS[slot]}</dt><dd>${esc(formatTime(plan.times[slot]))}</dd></div>`).join('')}
    </dl>
    <p class="form-help">They run until ${esc(formatDay(plan.until, { year: true }))}${plan.until === store.state.settings.targetDate ? ', your goal date' : ''}. Change the times under <a href="#/settings/times">Meal times</a>.</p>

    <section aria-labelledby="rem-subscribe">
      <div class="rule rule--medium"></div>
      <h2 id="rem-subscribe">Subscribe on your iPhone, once</h2>
      <ol class="steps">
        <li><a href="${esc(urls.webcal)}" data-key="subscribe">Subscribe in Calendar</a>, then tap Subscribe.</li>
        <li>In the Settings app, go to Apps, Calendar, Accounts, Subscribed Calendars, and open the new calendar. Turn off <strong>Remove Alarms</strong>, or the reminders arrive without alerts.</li>
        <li>If you added the reminders by hand before, delete that Meals calendar so they do not show up twice.</li>
      </ol>
      <p class="form-help">Calendar fetches the file again on its own schedule, so a change can take a few hours to arrive. If the link does nothing, open this address in Safari:</p>
      <p class="address"><span id="reminders-address">${esc(urls.webcal)}</span><button type="button" class="btn btn--small" data-action="copy-address" data-key="copy-address">Copy</button></p>
    </section>

    <section aria-labelledby="rem-key">
      <div class="rule rule--medium"></div>
      <h2 id="rem-key">GitHub key</h2>
      ${key ? `
        <p>Connected to ${esc(key.owner)}/${esc(key.repo)}. The key is saved only in Fuel on this device. It is not in backups, and it is only sent to GitHub.</p>
        <div class="btn-row">
          <button type="button" class="btn" data-action="open-connect" data-key="replace-key">Use a new key</button>
          <button type="button" class="btn" data-action="confirm-remove-key" data-key="remove-key">Remove the key</button>
        </div>` : `
        <p>Not connected. Without a key, the calendar file keeps whatever it has now.</p>`}
    </section>`;
}

function openConnectSheet() {
  const guess = guessRepo(location.href);
  const current = keyStore.get();
  const owner = (current && current.owner) || guess.owner;
  const repo = (current && current.repo) || guess.repo;
  openSheet(`
    <h2 class="sheet__title">Connect to GitHub</h2>
    <p>Fuel updates the calendar file by saving a new version of it to your repository, the same as editing it on github.com. For that it needs a key that can do only that.</p>
    <ol class="steps">
      <li><a href="${esc(NEW_KEY_URL)}" target="_blank" rel="noopener noreferrer">Open GitHub&rsquo;s form for a new key</a>. It comes filled in with a name, 90 days, and access to files.</li>
      <li>Under Repository access, choose <strong>Only select repositories</strong>, then <strong>${esc(repo || 'your repository')}</strong>.</li>
      <li>Tap Generate token, copy the key, and paste it here.</li>
    </ol>
    <form class="form" data-form="connect" novalidate>
      <div class="field">
        <label for="g-token">GitHub key</label>
        <input id="g-token" name="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_" required data-key="g-token">
      </div>
      <div class="field-pair">
        <div class="field"><label for="g-owner">Owner</label><input id="g-owner" name="owner" type="text" value="${esc(owner)}" autocomplete="off" autocapitalize="off" spellcheck="false" required></div>
        <div class="field"><label for="g-repo">Repository</label><input id="g-repo" name="repo" type="text" value="${esc(repo)}" autocomplete="off" autocapitalize="off" spellcheck="false" required></div>
      </div>
      <p class="form-help">The key is saved only in Fuel on this device, never in the repository or in a backup, and only sent to GitHub. Other sites you host at ${esc(location.host)} can read Fuel&rsquo;s storage on this device too, so remove the key when you stop using it.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide" data-key="connect">Connect</button>
    </form>`);
}

function openRemoveKeySheet() {
  openSheet(`
    <h2 class="sheet__title">Remove the GitHub key?</h2>
    <p>Fuel stops updating the calendar file. The file on your site, and your Calendar subscription, stay as they are.</p>
    <p>To cancel the key itself, also delete it on <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener noreferrer">GitHub&rsquo;s key page</a>.</p>
    <div class="sheet__actions">
      <button type="button" class="btn btn--danger btn--wide" data-action="remove-key">Remove the key</button>
      <button type="button" class="btn btn--wide" data-action="close-sheet">Keep it</button>
    </div>`);
}

async function updateReminders() {
  const key = keyStore.get();
  if (!key || publishing) return;
  const plan = remindersPlan();
  publishing = true;
  publishError = null;
  render();
  try {
    const { text } = buildRemindersICS({ fromDate: plan.today, untilDate: plan.until, kcalTarget: plan.kcal, mealTimes: plan.times });
    const result = await publishFile({
      token: key.token,
      owner: key.owner,
      repo: key.repo,
      path: key.path,
      content: text,
      message: 'Update meal reminders from Fuel',
      same: sameCalendar,
    });
    publishing = false;
    store.setPublished({ at: new Date().toISOString(), signature: plan.signature, kcal: plan.kcal, until: plan.until, times: plan.times, commit: result.commit });
    toast(result.unchanged ? 'The calendar file already matches your plan' : 'Updated. GitHub publishes it in about a minute.');
  } catch (error) {
    publishing = false;
    publishError = error && error.name === 'PublishError' ? error.message : 'Something went wrong. Try again.';
    render();
    toast('The calendar file was not updated');
  }
}

// ---- grocery prices and stores

let typicalMemo = { base: null, typical: null, catalog: null };

/** The price list with any typical prices you changed laid over it. */
function shopCatalog() {
  const { typical } = store.state.grocery;
  if (typicalMemo.base !== catalog || typicalMemo.typical !== typical) {
    typicalMemo = { base: catalog, typical, catalog: withTypical(catalog, typical) };
  }
  return typicalMemo.catalog;
}

function priceListMissing(title) {
  return `
    ${backToSettings()}
    <header class="page-head"><h1>${esc(title)}</h1></header>
    ${catalogState === 'loading' ? '<p class="empty">Getting the price list.</p>' : `
      <p class="notice notice--warn" role="alert">${ICON.warn}<span>The price list did not load. Check your connection and try again.</span></p>
      <button type="button" class="btn btn--primary" data-action="reload-prices" data-key="reload-prices">Try again</button>`}`;
}

function typicalText(item) {
  const [first, ...rest] = item.typical;
  return `${offerPrice(first)}${rest.length ? `, and ${rest.length} more ${rest.length === 1 ? 'size' : 'sizes'}` : ''}`;
}

function pricesPage() {
  if (catalogState !== 'ready') return priceListMissing('Grocery prices');
  const shop = shopCatalog();
  return `
    ${backToSettings()}
    <header class="page-head">
      <h1>Grocery prices</h1>
      <p>The typical price of each item. The grocery list uses it at any store where you have not recorded what you paid. A price you change here applies on this device.</p>
    </header>
    ${AISLES.map((aisle) => {
    const items = shop.items.filter((item) => item.aisle === aisle);
    if (!items.length) return '';
    return `
      <section class="aisle" aria-labelledby="price-${aisle.replace(/\W+/g, '-')}">
        <div class="rule rule--medium"></div>
        <header class="plan-day__head"><h2 id="price-${aisle.replace(/\W+/g, '-')}">${esc(aisle)}</h2><p>${items.length} items</p></header>
        <div class="rows">
          ${items.map((item) => `
            <button type="button" class="log-row" data-action="edit-typical" data-item="${esc(item.id)}" data-key="typ-${esc(item.id)}">
              <span class="log-row__date">${esc(item.name)}</span>
              <span class="log-row__nums">${esc(typicalText(item))}${item.typicalChanged ? ', <strong>yours</strong>' : ''}</span>
              ${ICON.chevron}
            </button>`).join('')}
        </div>
      </section>`;
  }).join('')}`;
}

function openTypicalSheet(itemId) {
  const original = catalog.itemById.get(itemId);
  const item = shopCatalog().itemById.get(itemId);
  if (!item) return;
  const offer = item.typical[0];
  const units = unitsFor(item);
  const unit = units.includes(offer.unit) ? offer.unit : units[0];
  openSheet(`
    <p class="sheet__context">${esc(item.aisle)}</p>
    <h2 class="sheet__title">${esc(item.name)}</h2>
    <p>Typical price now: ${esc(item.typical.map(offerPrice).join('; '))}${item.typicalChanged ? ', set by you' : ''}.</p>
    <p class="form-help">${item.typicalChanged
    ? `The price list says ${esc(original.typical.map(offerPrice).join('; '))}.`
    : `${esc(catalog.sources[offer.src] || 'Typical price')}.`}</p>
    <form class="form" data-form="typical" data-item="${esc(itemId)}" novalidate>
      <div class="field-pair">
        <div class="field"><label for="ty-size">Package size</label><input id="ty-size" name="size" type="number" inputmode="decimal" min="0" step="any" value="${offer.kind === 'weight' ? '' : offer.size}"></div>
        <div class="field">
          <label for="ty-unit">Unit</label>
          <select id="ty-unit" name="unit">
            ${units.map((u) => `<option value="${esc(u)}"${u === unit ? ' selected' : ''}>${esc(u === PER_LB ? 'sold per lb' : u)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label for="ty-price">Price, $</label><input id="ty-price" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${(offer.cents / 100).toFixed(2)}" required></div>
      <p class="form-help">For food sold by the pound, choose sold per lb and leave the size empty. Prices you record at a store still come first there.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn--primary btn--wide">Save the typical price</button>
      ${item.typicalChanged ? `<button type="button" class="btn btn--wide" data-action="reset-typical" data-item="${esc(itemId)}">Use the price list&rsquo;s price</button>` : ''}
    </form>`);
}

function storesPage() {
  if (catalogState !== 'ready') return priceListMissing('Stores');
  const { grocery } = store.state;
  const stores = allStores(catalog, grocery.stores);
  return `
    ${backToSettings()}
    <header class="page-head">
      <h1>Stores</h1>
      <p>The stores that appear under Shopping at on the grocery list. Hiding one keeps its prices.</p>
    </header>
    <div class="rows">
      ${stores.map((s) => `
        <button type="button" class="switch" role="switch" aria-checked="${!grocery.hidden.includes(s.id)}" data-action="toggle-store" data-id="${esc(s.id)}" data-key="store-${esc(s.id)}">
          <span>${esc(s.name)}<small>${s.brand ? `Store brand ${esc(s.brand)}` : 'No store brand'}${s.id.startsWith('my-') ? ', added by you' : ''}</small></span>${ICON.check}
        </button>`).join('')}
    </div>
    <div class="btn-row">
      <button type="button" class="btn" data-action="open-add-store" data-key="add-store">Add a store</button>
    </div>`;
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

/** Show a sheet. keepScroll redraws one that is already open without losing your place in it. */
function openSheet(html, { keepScroll = false } = {}) {
  const top = keepScroll ? sheet.scrollTop : 0;
  const active = document.activeElement;
  const focusKey = keepScroll && active && sheet.contains(active) ? active.dataset.key : null;
  sheet.innerHTML = `
    <button type="button" class="icon-btn sheet__close" data-action="close-sheet" aria-label="Close">${ICON.close}</button>
    <div class="sheet__body">${html}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = top;
  const again = focusKey ? sheet.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) : null;
  if (again) again.focus({ preventScroll: true });
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
      <p class="label__line">1 serving${meal.mins ? `, about ${meal.mins} ${meal.mins === 1 ? 'minute' : 'minutes'} to make` : ''}</p>
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
      ${recipeHtml(meal)}` : ''}
    <div class="sheet__actions">
      ${row.entry ? `
        <p class="sheet__status">${ICON.check}Logged${loggedAt ? ` at ${esc(loggedAt)}` : ''}</p>
        <button type="button" class="btn btn--wide" data-action="toggle-meal" data-date="${date}" data-slot="${slot}">Remove from the log</button>` : `
        <button type="button" class="btn btn--primary btn--wide" data-action="toggle-meal" data-date="${date}" data-slot="${slot}">Log this meal</button>
        <button type="button" class="btn btn--wide" data-action="open-swap" data-date="${date}" data-slot="${slot}">Swap for something else</button>`}
      ${meal ? `<button type="button" class="btn btn--wide" data-action="edit-meal" data-meal="${esc(meal.id)}">Change this meal&rsquo;s recipe</button>` : ''}
    </div>`);
}

let swapScope = 'day'; // 'day' changes one date; 'every' changes that day of the two-week menu

function openSwapSheet(date, slot, { keepScope = false } = {}) {
  const model = dayModel(date);
  const row = model.rows.find((r) => r.slot === slot);
  if (!row) return;
  const snack = isSnackSlot(slot);
  if (!keepScope) swapScope = 'day';
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

  const weekday = DAY_NAMES[weekdayIndex(date)];
  openSheet(`
    <h2 class="sheet__title">Swap ${esc(lower(row.label))}</h2>
    ${snack ? '' : `
      <div class="segmented" role="radiogroup" aria-label="Which days to change">
        <button type="button" role="radio" aria-checked="${swapScope === 'day'}" data-action="swap-scope" data-scope="day" data-date="${date}" data-slot="${slot}" data-key="scope-day">${date === todayStr() ? 'Just today' : `Just ${esc(formatDay(date))}`}</button>
        <button type="button" role="radio" aria-checked="${swapScope === 'every'}" data-action="swap-scope" data-scope="every" data-date="${date}" data-slot="${slot}" data-key="scope-every">Every other ${weekday}</button>
      </div>`}
    <p>${esc(swapScope === 'every' && !snack ? `Changes the two-week menu, so every other ${weekday} gets it, starting ${date === todayStr() ? 'today' : formatDay(date)}.` : intro)}</p>
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
    const chosen = meal === 'none' ? null : mealById(meal);
    if (swapScope === 'every' && MAIN_SLOTS.includes(slot) && chosen) {
      const index = rotationIndex(date);
      store.batch(() => {
        store.setMenu(index, slot, meal === BASE_ROTATION[index][slot] ? null : meal);
        store.setSwap(date, slot, null);
      });
      closeSheet();
      toast(`Every other ${DAY_NAMES[weekdayIndex(date)]} now has ${lower(chosen.name)}`);
      return;
    }
    store.setSwap(date, slot, meal);
    closeSheet();
    toast(chosen ? `Swapped to ${lower(chosen.name)}` : 'Skipped for this day');
  },
  'swap-scope': (el) => {
    swapScope = el.dataset.scope === 'every' ? 'every' : 'day';
    openSwapSheet(el.dataset.date, el.dataset.slot, { keepScope: true });
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
    <p>This removes your plan, your meal log, your weigh-ins and your grocery choices from this device. It cannot be undone. Save a backup first if you might want them back.</p>
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
    const text = document.getElementById('reminders-address').textContent;
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

  // ---- settings: meal times
  'reset-times': () => {
    store.setMealTimes({ ...CONFIG.mealTimes });
    toast('Back to the original times');
  },

  // ---- settings: meals
  'view-meal': (el) => openMealInfo(el.dataset.meal),
  'new-meal': () => {
    draft = startDraft(null);
    openMealEditor();
  },
  'edit-meal': (el) => {
    if (!mealById(el.dataset.meal)) return;
    draft = startDraft(el.dataset.meal);
    openMealEditor();
  },
  'draft-mode': (el) => {
    draft.mode = el.dataset.mode === 'facts' ? 'facts' : 'items';
    draft.nutOk = false;
    openMealEditor({ keepScroll: true });
  },
  'draft-add-food': () => openFoodPicker(),
  'draft-back': () => openMealEditor(),
  'draft-pick-food': (el) => {
    draft.items.push({ food: el.dataset.food, grams: '100', how: '', was: null });
    openMealEditor({ focus: `[data-key="grams-${draft.items.length - 1}"]` });
  },
  'draft-remove': (el) => {
    draft.items.splice(Number(el.dataset.index), 1);
    openMealEditor({ keepScroll: true });
  },
  'draft-scale': (el) => {
    const factor = Number(el.dataset.factor);
    for (const item of draft.items) {
      const grams = Number(item.grams);
      if (grams > 0) item.grams = gramsText(Math.min(MAX_GRAMS, grams < 20 ? Math.round(grams * factor * 10) / 10 : Math.round(grams * factor)));
    }
    openMealEditor({ keepScroll: true });
  },
  'reset-meal': (el) => {
    store.resetMeal(el.dataset.meal);
    closeSheet();
    toast('Back to the original');
  },
  'confirm-delete-meal': (el) => openDeleteMealSheet(el.dataset.meal),
  'delete-meal': (el) => {
    const meal = mealById(el.dataset.meal);
    store.deleteMeal(el.dataset.meal);
    closeSheet();
    toast(`Deleted ${meal ? meal.name : 'the meal'}`);
  },
  'toggle-snack-auto': (el) => {
    const meal = mealById(el.dataset.meal);
    if (!meal) return;
    store.setSnackAuto(meal.id, Boolean(meal.manualOnly));
    openMealInfo(meal.id, { keepScroll: true });
  },

  // ---- settings: the two-week menu
  'menu-cell': (el) => openMenuCell(Number(el.dataset.index), el.dataset.slot),
  'choose-menu': (el) => {
    const index = Number(el.dataset.index);
    const { slot, meal } = el.dataset;
    const chosen = mealById(meal);
    if (!chosen) return;
    store.setMenu(index, slot, meal === BASE_ROTATION[index][slot] ? null : meal);
    closeSheet();
    toast(`Week ${index < 7 ? 'A' : 'B'} ${DAY_NAMES[index % 7]}s now have ${lower(chosen.name)}`);
  },
  'confirm-reset-menu': () => openSheet(`
    <h2 class="sheet__title">Go back to the original menu?</h2>
    <p>Every day of the two weeks gets its original breakfast, lunch and dinner. Swaps you made for single days stay.</p>
    <div class="sheet__actions">
      <button type="button" class="btn btn--primary btn--wide" data-action="reset-menu">Use the original menu</button>
      <button type="button" class="btn btn--wide" data-action="close-sheet">Keep my menu</button>
    </div>`),
  'reset-menu': () => {
    store.resetMenu();
    closeSheet();
    toast('Back to the original menu');
  },

  // ---- settings: reminders
  'open-connect': () => openConnectSheet(),
  'update-reminders': () => updateReminders(),
  'confirm-remove-key': () => openRemoveKeySheet(),
  'remove-key': () => {
    keyStore.clear();
    publishError = null;
    closeSheet();
    render();
    toast('Key removed');
  },

  // ---- settings: grocery prices and stores
  'edit-typical': (el) => openTypicalSheet(el.dataset.item),
  'reset-typical': (el) => {
    store.setTypicalPrice(el.dataset.item, null);
    closeSheet();
    toast('Back to the price list');
  },
  'toggle-store': (el) => {
    const { id } = el.dataset;
    const { grocery } = store.state;
    const hiding = !grocery.hidden.includes(id);
    const shown = allStores(catalog, grocery.stores).filter((s) => !grocery.hidden.includes(s.id));
    if (hiding && shown.length <= 1) {
      toast('Keep at least one store');
      return;
    }
    store.setStoreHidden(id, hiding);
  },
  'open-add-store': () => openStoreSheet(),

  // ---- groceries
  'open-item': (el) => openItemSheet(el.dataset.item),
  'toggle-item': (el) => {
    const { list } = groceryModel();
    const line = list.lines.find((entry) => entry.id === el.dataset.item);
    if (!line) return;
    if (line.checked) {
      store.removeGroceryLots((lot) => lot.item === line.id && lot.date === list.start && !lot.home);
    } else {
      freshTick = line.id;
      store.addGroceryLot(lotFor(line, list, false), list.start);
    }
  },
  'open-have': () => openHaveSheet(),
  'toggle-have': (el) => {
    const id = el.dataset.item;
    if (groceryModel().list.atHome.some((entry) => entry.id === id)) store.removeGroceryLots((lot) => lot.item === id);
    else markAtHome(id);
    openHaveSheet({ keepScroll: true });
  },
  'have-item': (el) => {
    const marked = markAtHome(el.dataset.item);
    closeSheet();
    if (marked) toast('Marked as at home');
  },
  'out-of-item': (el) => {
    store.removeGroceryLots((lot) => lot.item === el.dataset.item);
    closeSheet();
    toast('Back on the list');
  },
  'set-brand': (el) => {
    const { item, brand } = el.dataset;
    const previous = store.state.grocery.prefs[item];
    store.setGroceryPref(item, brand ? { brand, keep: previous ? previous.keep : false } : null);
    openItemSheet(item, { keepScroll: true });
  },
  'toggle-keep': (el) => {
    const pref = store.state.grocery.prefs[el.dataset.item];
    if (pref) store.setGroceryPref(el.dataset.item, { ...pref, keep: !pref.keep });
    openItemSheet(el.dataset.item, { keepScroll: true });
  },
  'remove-price': (el) => {
    store.removeGroceryPrice(el.dataset.id);
    openItemSheet(el.dataset.item, { keepScroll: true });
    toast('Price removed');
  },
  'open-budget': () => openBudgetSheet(),
  'clear-budget': () => {
    store.setGrocery({ budget: null });
    closeSheet();
    toast('Budget removed');
  },
  'apply-moves': () => {
    const { moves } = groceryModel();
    if (!moves.length) return;
    store.batch(() => {
      for (const move of moves) {
        if (move.kind === 'brand') store.setGroceryPref(move.itemId, null);
        else store.setSwap(move.date, move.slot, move.toId);
      }
    });
    toast(moves.length === 1 ? 'Change made' : `${moves.length} changes made`);
  },
  'share-list': () => shareList(),
  'reload-prices': () => {
    catalogState = 'loading';
    render();
    pullPriceList();
  },
  'remove-store': (el) => {
    store.removeGroceryStore(el.dataset.id);
    openStoreSheet();
    toast('Store removed');
  },
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

  // ---- settings
  times: (form) => {
    const data = Object.fromEntries(new FormData(form));
    const times = {};
    for (const slot of TIME_SLOTS) times[slot] = String(data[slot] || '').slice(0, 5);
    const bad = TIME_SLOTS.find((slot) => !isValidTime(times[slot]));
    showError(form, bad ? `Enter a time for ${lower(SLOT_LABELS[bad])}.` : null);
    if (bad) return;
    store.setMealTimes(times);
    toast(reminderStatus().state === 'stale' ? 'Saved. Update the reminders to move the alerts.' : 'Meal times saved');
  },

  meal: (form) => {
    const d = draft;
    if (!d) return;
    const name = d.name.trim();
    let problem = name ? null : 'Give the meal a name.';
    let items = [];
    let facts = null;
    if (!problem && d.mode === 'items') {
      if (!d.items.length) problem = 'Add at least one ingredient, or enter the meal as totals.';
      else if (d.items.some((item) => !(Number(item.grams) > 0 && Number(item.grams) <= MAX_GRAMS))) {
        problem = `Give every ingredient an amount above 0 and up to ${formatNumber(MAX_GRAMS)} g, or remove it.`;
      }
      items = d.items.map(({ food, grams, how, was }) => {
        const g = Math.round(Number(grams) * 10) / 10;
        return [food, g, was !== null && was !== undefined && Math.abs(g - was) < 0.05 ? how : ''];
      });
    }
    if (!problem && d.mode === 'facts') {
      facts = cleanFacts(d.facts);
      if (!facts) problem = 'Enter the calories, from 1 to 4,000. Protein, carbs and fat are in grams; leave them empty if you do not know.';
    }
    if (!problem && !d.nutOk) {
      const word = nutWordIn(`${name} ${d.method}`);
      if (word) {
        d.nutOk = true;
        problem = 'Check the nut warning above. If this meal is safe for you, tap Save anyway.';
        form.querySelector('[data-key="save-meal"]').textContent = 'Save anyway';
      }
    }
    showError(form, problem);
    if (problem) return;

    const base = d.id ? baseMeal(d.id) : null;
    let saved;
    if (base) {
      const same = name === base.name && d.method.trim() === base.method && JSON.stringify(items) === JSON.stringify(base.items);
      if (same) {
        store.resetMeal(d.id);
        saved = d.id;
      } else {
        saved = store.saveMeal(d.id, { name, items, method: d.method });
      }
    } else if (d.id) {
      saved = store.saveMeal(d.id, { name, slot: d.slot, items, facts, method: d.method });
    } else {
      saved = store.addMeal({ name, slot: d.slot, items, facts, method: d.method });
    }
    if (!saved) {
      showError(form, 'The meal could not be saved. Check the amounts and try again.');
      return;
    }
    draft = null;
    closeSheet();
    toast(d.id ? `Saved ${name}` : `Added ${name}`);
  },

  connect: async (form) => {
    const data = Object.fromEntries(new FormData(form));
    const token = String(data.token || '').trim();
    const owner = String(data.owner || '').trim();
    const repo = String(data.repo || '').trim();
    let problem = null;
    if (!looksLikeKey(token)) problem = 'Paste the whole key. It starts with github_pat_ and has no spaces.';
    else if (isClassicKey(token)) problem = 'That is a classic key, which can change every repository you own. Use the link above to make a fine-grained key, which can be held to this one repository.';
    else if (!isRepoName(owner) || !isRepoName(repo)) problem = 'Enter the owner and the repository, as they appear in github.com/owner/repository.';
    showError(form, problem);
    if (problem) return;
    const button = form.querySelector('[data-key="connect"]');
    button.disabled = true;
    button.textContent = 'Checking';
    try {
      const { fullName } = await checkKey({ token, owner, repo });
      if (!keyStore.set({ token, owner, repo, path: guessRepo(location.href).path })) {
        throw Object.assign(new Error('This browser would not save the key. Private browsing blocks storage.'), { name: 'PublishError' });
      }
      publishError = null;
      closeSheet();
      render();
      toast(`Connected to ${fullName}`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Connect';
      showError(form, error && error.name === 'PublishError' ? error.message : 'Something went wrong. Try again.');
    }
  },

  typical: (form) => {
    const data = Object.fromEntries(new FormData(form));
    const itemId = form.dataset.item;
    const item = catalog.itemById.get(itemId);
    const unit = String(data.unit || '');
    const size = unit === PER_LB ? 1 : Number(data.size);
    const price = Number(data.price);
    let problem = null;
    if (String(data.price || '').trim() === '' || !(price > 0 && price <= 500)) problem = 'Enter the price, between $0.01 and $500.';
    else if (unit !== PER_LB && !(size > 0)) problem = 'Enter the package size, for example 32 with the unit oz.';
    else if (!makeOffer(item, { unit, size, price })) problem = 'That size and unit do not work for this item.';
    showError(form, problem);
    if (problem) return;
    store.setTypicalPrice(itemId, { unit, size, price });
    closeSheet();
    toast(`Typical price set to ${formatMoney(Math.round(price * 100))}`);
  },

  // ---- groceries
  budget: (form) => {
    const raw = String(new FormData(form).get('budget') || '').trim();
    const value = Number(raw);
    const problem = raw !== '' && value >= 1 && value <= 5000 ? null : 'Enter a budget between $1 and $5,000.';
    showError(form, problem);
    if (problem) return;
    store.setGrocery({ budget: value });
    closeSheet();
    toast(`Budget set to ${budgetText(Math.round(value * 100))}`);
  },

  'add-price': (form) => {
    const data = Object.fromEntries(new FormData(form));
    const itemId = form.dataset.item;
    const item = catalog.itemById.get(itemId);
    const shop = groceryModel().list.store;
    const brand = String(data.brand || '').trim();
    const hasPrice = String(data.price || '').trim() !== '';
    const hasSize = String(data.size || '').trim() !== '';

    if (!hasPrice && !hasSize) {
      // A brand on its own is a brand choice, with the price to follow.
      showError(form, brand ? null : 'Enter a price, or just a brand to choose it before you know its price.');
      if (!brand) return;
      const previous = store.state.grocery.prefs[itemId];
      store.setGroceryPref(itemId, { brand, keep: previous ? previous.keep : false });
      openItemSheet(itemId, { keepScroll: true });
      toast(`Brand set to ${brand}`);
      return;
    }
    const unit = String(data.unit || '');
    const size = unit === PER_LB ? 1 : Number(data.size);
    const price = Number(data.price);
    let problem = null;
    if (!hasPrice || !(price > 0 && price <= 500)) problem = 'Enter the price, between $0.01 and $500.';
    else if (unit !== PER_LB && !hasSize) problem = 'Enter the package size, for example 32 with the unit oz.';
    else if (!makeOffer(item, { unit, size, price })) problem = 'Enter a package size above zero.';
    showError(form, problem);
    if (problem) return;
    store.addGroceryPrice({ item: itemId, store: shop.id, brand, unit, size, price, date: todayStr() });
    openItemSheet(itemId, { keepScroll: true });
    toast(`Saved ${formatMoney(Math.round(price * 100))} at ${shop.name}`);
  },

  'add-store': (form) => {
    const data = Object.fromEntries(new FormData(form));
    const name = String(data.name || '').trim();
    let problem = name ? null : 'Enter the name of the store.';
    if (!problem && allStores(catalog, store.state.grocery.stores).some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      problem = 'That store is already in the list.';
    }
    showError(form, problem);
    if (problem) return;
    if (!store.addGroceryStore({ name, brand: String(data.brand || '') })) {
      showError(form, 'There is no room for another store. Remove one first.');
      return;
    }
    closeSheet();
    toast(`Shopping at ${name}`);
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

  // ---- groceries
  'grocery-store': (select) => {
    if (select.value === '+') {
      select.value = groceryModel().list.store.id;
      sheetOpenerKey = 'g-store';
      openStoreSheet();
      return;
    }
    store.setGrocery({ store: select.value });
  },
  'grocery-days': (select) => store.setGrocery({ days: Number(select.value) }),
  'grocery-servings': (select) => store.setGrocery({ servings: Number(select.value) }),
};

// ------------------------------------------------------------------ wiring

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const handler = actions[el.dataset.action];
  if (!handler) return;
  if (app.contains(el) && el.dataset.key) sheetOpenerKey = el.dataset.key;
  withAnchor(el, () => handler(el, event));
});

// Typing that updates a sheet in place, without redrawing it.
const inputs = {
  'draft-name': (el) => {
    draft.name = el.value;
    draft.nutOk = false;
    refreshDraft();
  },
  'draft-method': (el) => {
    draft.method = el.value;
    draft.nutOk = false;
    refreshDraft();
  },
  'draft-grams': (el) => {
    const index = Number(el.dataset.index);
    draft.items[index].grams = el.value;
    refreshDraft(index);
  },
  'draft-fact': (el) => {
    draft.facts[el.dataset.fact] = el.value;
    refreshDraft();
  },
  'draft-slot': (el) => {
    if (SLOTS.includes(el.value)) draft.slot = el.value;
  },
  'food-search': (el) => filterFoods(el.value),
};

document.addEventListener('input', (event) => {
  const name = event.target.dataset ? event.target.dataset.input : null;
  const handler = name ? inputs[name] : null;
  if (!handler || (name.startsWith('draft-') && !draft)) return;
  handler(event.target);
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
  if (handler) withAnchor(event.target, () => handler(event.target));
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
  if (catalogState === 'failed') pullPriceList();
  const newDay = renderedDay !== todayStr();
  const hasForm = !store.state.settings || ['progress', 'settings'].includes(parseRoute().name);
  if (newDay || !hasForm) render();
});

render();
pullPriceList();

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocal)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
