// Pure logic: dates, calorie targets, the daily plan, weight pace, and the
// calendar file. No DOM and no storage in here, so it runs the same in the
// browser, in Node (tools/) and in tests.

import { CONFIG } from './config.js';
import { MEALS, ROTATION, ingredientText, mealById, mealsVersion } from './meals.js';

// ---------------------------------------------------------------- dates
// Dates are 'YYYY-MM-DD' strings in the user's local calendar. Arithmetic is
// done on whole-day numbers so daylight-saving changes cannot shift a day.

const DAY_MS = 86400000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(str) {
  const m = DATE_RE.exec(String(str));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function dayNumber(str) {
  const m = DATE_RE.exec(String(str));
  if (!m) throw new Error(`Not a date: ${str}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function dateFromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(str, n) {
  return dateFromDayNumber(dayNumber(str) + n);
}

/** Days from a to b (positive when b is later). */
export function diffDays(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/** Monday = 0 ... Sunday = 6. */
export function weekdayIndex(str) {
  return (((dayNumber(str) + 3) % 7) + 7) % 7;
}

/** Position in the two-week rotation, 0-13. Mondays are 0 and 7. */
export function rotationIndex(str) {
  const n = dayNumber(str);
  const week = Math.floor((n - 4) / 7); // day 4 (1970-01-05) was a Monday
  const parity = ((week % 2) + 2) % 2;
  return parity * 7 + weekdayIndex(str);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Wed, Nov 25' (or 'Wednesday, Nov 25' with long = true). */
export function formatDay(str, { long = false, year = false } = {}) {
  const [y, m, d] = str.split('-').map(Number);
  const names = long ? WEEKDAYS_LONG : WEEKDAYS;
  return `${names[weekdayIndex(str)]}, ${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
}

export function monthName(monthIndex) {
  return MONTHS[monthIndex];
}

/** '07:30' -> '7:30 AM' */
export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function minutesOfDay(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function roundTo(n, step) {
  return Math.round(n / step) * step;
}

// ---------------------------------------------------------------- targets

export const KCAL_FLOOR = 1500; // never plan below this
export const MAX_DEFICIT = 1100; // kcal a day, a little over 2 lb a week
export const KCAL_PER_LB = 3500;
const DEFAULT_ACTIVITY_FACTOR = 1.55; // "moderately active" when no watch average is given
const PROTEIN_G_PER_GOAL_LB = 0.726; // 1.6 g per kg of goal weight

/**
 * Work out the daily calorie and protein targets.
 * input: { bmr, weight, goalWeight, targetDate, activeKcal? }
 */
export function computeTargets(input, today) {
  const bmr = Number(input.bmr);
  const weight = Number(input.weight);
  const goal = Number(input.goalWeight);
  const active = Number(input.activeKcal) > 0 ? Number(input.activeKcal) : 0;
  const daysLeft = Math.max(1, diffDays(today, input.targetDate));
  const toLose = Math.max(0, weight - goal);
  const requiredDeficit = (toLose * KCAL_PER_LB) / daysLeft;
  const deficit = Math.min(requiredDeficit, MAX_DEFICIT);

  // Daily burn = resting (BMR) + activity + digesting food (about 10% of intake).
  // With a watch average we add those up. Without one we assume a moderately
  // active day, BMR x 1.55, which already includes all three.
  const rawKcal = active ? (bmr + active - deficit) / 0.9 : bmr * DEFAULT_ACTIVITY_FACTOR - deficit;
  const kcal = Math.max(KCAL_FLOOR, roundTo(rawKcal, 50));
  const burn = active ? bmr + active + 0.1 * kcal : bmr * DEFAULT_ACTIVITY_FACTOR;
  const actualDeficit = Math.max(0, burn - kcal);

  let limitedBy = null;
  if (roundTo(rawKcal, 50) < KCAL_FLOOR) limitedBy = 'floor';
  else if (requiredDeficit > MAX_DEFICIT) limitedBy = 'pace';

  return {
    kcal,
    protein: roundTo(goal * PROTEIN_G_PER_GOAL_LB, 5),
    burn: Math.round(burn),
    deficit: Math.round(actualDeficit),
    requiredDeficit: Math.round(requiredDeficit),
    lbPerWeek: (actualDeficit * 7) / KCAL_PER_LB,
    projectedLoss: (actualDeficit * daysLeft) / KCAL_PER_LB,
    toLose,
    daysLeft,
    usedWatchAverage: Boolean(active),
    limitedBy,
  };
}

/**
 * The targets that applied on a given date. A change of target takes effect
 * from the day it was made, so earlier days keep being judged by the target
 * they were eaten under.
 */
export function targetFor(settings, dateStr) {
  const history = settings.targets && settings.targets.length
    ? settings.targets
    : [{ from: settings.startDate, kcal: settings.kcalTarget, protein: settings.proteinTarget }];
  let chosen = history[0];
  for (const entry of history) if (entry.from <= dateStr) chosen = entry;
  return { kcal: chosen.kcal, protein: chosen.protein };
}

/** A copy of the settings with new targets taking effect today. */
export function withTargets(settings, kcal, protein, today) {
  const history = settings.targets && settings.targets.length
    ? settings.targets.map((entry) => ({ ...entry }))
    : [{ from: settings.startDate, kcal: settings.kcalTarget, protein: settings.proteinTarget }];
  const last = history[history.length - 1];
  if (last.kcal !== kcal || last.protein !== protein) {
    if (last.from >= today) history[history.length - 1] = { from: last.from, kcal, protein };
    else history.push({ from: today, kcal, protein });
  }
  return {
    ...settings,
    kcalTarget: kcal,
    proteinTarget: protein,
    targets: history,
    targetChangedOn: kcal !== settings.kcalTarget ? today : settings.targetChangedOn || null,
  };
}

// ---------------------------------------------------------------- daily plan

export const SLOT_LABELS = {
  breakfast: 'Breakfast',
  morningSnack: 'Morning snack',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};
const MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];
const SNACK_SLOTS = ['snack', 'morningSnack'];

// ---------------------------------------------------------------- meal times
// The times in js/config.js until changed in the app. setMealTimes() takes
// the saved ones; anything missing or malformed keeps the configured time.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
let currentTimes = { ...CONFIG.mealTimes };

export function isValidTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** Use these meal times from now on. Returns the times now in use. */
export function setMealTimes(times = {}) {
  const next = {};
  for (const slot of Object.keys(SLOT_LABELS)) {
    next[slot] = times && isValidTime(times[slot]) ? times[slot] : CONFIG.mealTimes[slot];
  }
  currentTimes = next;
  return { ...currentTimes };
}

export function getMealTimes() {
  return { ...currentTimes };
}

/** Slots in the order they happen during the day. */
export function orderedSlots(mealTimes = currentTimes) {
  return Object.keys(SLOT_LABELS).sort((a, b) => minutesOfDay(mealTimes[a]) - minutesOfDay(mealTimes[b]));
}

export function isSnackSlot(slot) {
  return SNACK_SLOTS.includes(slot);
}

/** Which library slot a plan slot draws its meals from. */
export function librarySlot(slot) {
  return isSnackSlot(slot) ? 'snack' : slot;
}

// The snacks the plan may pick by itself, worked out again whenever the meals change.
let autoSnacks = { version: -1, list: [] };
function snacksToPick() {
  if (autoSnacks.version !== mealsVersion()) {
    autoSnacks = { version: mealsVersion(), list: MEALS.filter((meal) => meal.slot === 'snack' && !meal.manualOnly) };
  }
  return autoSnacks.list;
}
const SNACK_OVER = 25; // a snack may run this far past its budget
export const TWO_SNACK_BUDGET = 460; // above this the leftover is split over two snacks

/**
 * Choose a snack that fills a calorie budget. Stays within 25 kcal above it,
 * prefers ones close to it, and rotates through the fitting options so the
 * same snack does not come up every day.
 */
export function pickSnack(budget, rotation, excludeId = null) {
  const pool = snacksToPick().filter((s) => s.id !== excludeId);
  const fits = (low) => pool.filter((s) => s.kcal <= budget + SNACK_OVER && s.kcal >= budget - low);
  let options = fits(50);
  if (options.length < 3) options = fits(90);
  if (options.length < 3) options = fits(130);
  if (!options.length) {
    const under = pool.filter((s) => s.kcal <= budget + SNACK_OVER);
    if (!under.length) return null;
    const best = Math.max(...under.map((s) => s.kcal));
    options = under.filter((s) => s.kcal === best);
  }
  return options[((rotation % options.length) + options.length) % options.length];
}

/**
 * The plan for one date.
 * swaps: { [slot]: mealId } and, for the two snack slots, 'none' to skip it.
 * The three meals follow the rotation; snacks fill what the meals leave over.
 */
export function planForDate(dateStr, kcalTarget, swaps = {}, mealTimes = currentTimes) {
  const rotation = rotationIndex(dateStr);
  const base = ROTATION[rotation];
  const chosen = {};
  const swapped = {};
  for (const slot of MAIN_SLOTS) {
    const override = swaps[slot] ? mealById(swaps[slot]) : null;
    const valid = Boolean(override) && override.slot === slot;
    chosen[slot] = valid ? override : mealById(base[slot]);
    swapped[slot] = valid && override.id !== base[slot];
  }
  const mealsKcal = MAIN_SLOTS.reduce((sum, slot) => sum + chosen[slot].kcal, 0);
  const snackBudget = kcalTarget - mealsKcal;

  const auto = { snack: null, morningSnack: null };
  if (snackBudget > TWO_SNACK_BUDGET) {
    auto.snack = pickSnack(Math.round(snackBudget * 0.55), rotation);
    auto.morningSnack = pickSnack(snackBudget - (auto.snack ? auto.snack.kcal : 0), rotation + 3, auto.snack && auto.snack.id);
  } else {
    auto.snack = pickSnack(snackBudget, rotation);
  }
  for (const slot of SNACK_SLOTS) {
    if (swaps[slot] === 'none') {
      chosen[slot] = null;
      swapped[slot] = auto[slot] !== null;
      continue;
    }
    const override = swaps[slot] ? mealById(swaps[slot]) : null;
    const valid = Boolean(override) && override.slot === 'snack';
    chosen[slot] = valid ? override : auto[slot];
    swapped[slot] = valid && (!auto[slot] || override.id !== auto[slot].id);
  }

  // The morning snack only appears on days that have one (or had one skipped).
  const slots = orderedSlots(mealTimes)
    .filter((slot) => slot !== 'morningSnack' || chosen.morningSnack || auto.morningSnack)
    .map((slot) => ({
      slot,
      label: SLOT_LABELS[slot],
      time: mealTimes[slot],
      meal: chosen[slot],
      swapped: swapped[slot],
    }));
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const { meal } of slots) {
    if (!meal) continue;
    for (const key of Object.keys(totals)) totals[key] += meal[key];
  }
  return { date: dateStr, rotation, slots, snackBudget, ...totals };
}

/** Sum the calories and protein of a list of log entries. */
export function sumEntries(entries) {
  let kcal = 0;
  let protein = 0;
  for (const e of entries) {
    kcal += Number(e.kcal) || 0;
    protein += Number(e.protein) || 0;
  }
  return { kcal: Math.round(kcal), protein: Math.round(protein) };
}

// ---------------------------------------------------------------- weight

/** Where the straight-line plan puts your weight on a date. */
export function planWeightOn(dateStr, settings) {
  const total = diffDays(settings.startDate, settings.targetDate);
  if (total <= 0) return settings.goalWeight;
  const done = Math.min(Math.max(diffDays(settings.startDate, dateStr), 0), total);
  return settings.startWeight + ((settings.goalWeight - settings.startWeight) * done) / total;
}

/** Least-squares slope through weigh-ins, as pounds LOST per week. */
export function lossPerWeek(points) {
  if (points.length < 2) return null;
  const xs = points.map((p) => dayNumber(p.date));
  const ys = points.map((p) => p.lb);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return (-num / den) * 7;
}

const MIN_CHECK_SPAN_DAYS = 14;
const TREND_WINDOW_DAYS = 28;
const EARLY_WEEKS_DAYS = 21; // water weight makes the first weeks look fast

/**
 * Compare the weigh-in trend with the pace the goal needs and suggest a
 * calorie change when they are far apart.
 * Returns { status, rate?, needed?, suggestedKcal?, projectedDate?, daysUntilCheck? }
 * status: 'no-data' | 'reached' | 'early' | 'on-track' | 'slow' | 'floor' | 'fast'
 */
export function paceCheck(weights, settings) {
  const sorted = [...weights].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!sorted.length) return { status: 'no-data' };
  const latest = sorted[sorted.length - 1];
  if (latest.lb <= settings.goalWeight) return { status: 'reached', latest };

  const since = settings.targetChangedOn && settings.targetChangedOn > settings.startDate
    ? settings.targetChangedOn
    : settings.startDate;
  const trendStart = addDays(latest.date, -TREND_WINDOW_DAYS);
  const windowStart = since > trendStart ? since : trendStart;
  const points = sorted.filter((w) => w.date >= windowStart);
  const span = points.length >= 2 ? diffDays(points[0].date, latest.date) : 0;
  if (points.length < 3 || span < MIN_CHECK_SPAN_DAYS) {
    const first = points.length ? points[0].date : latest.date;
    return {
      status: 'early',
      latest,
      daysUntilCheck: Math.max(1, MIN_CHECK_SPAN_DAYS - diffDays(first, latest.date)),
      weighIns: points.length,
    };
  }

  const rate = lossPerWeek(points);
  const daysLeft = Math.max(1, diffDays(latest.date, settings.targetDate));
  const needed = ((latest.lb - settings.goalWeight) / daysLeft) * 7;
  const maxSafe = latest.lb * 0.01; // 1% of body weight a week
  const result = { latest, rate, needed, weighIns: points.length };
  if (rate > 0.05) {
    const weeks = (latest.lb - settings.goalWeight) / rate;
    result.projectedDate = addDays(latest.date, Math.ceil(weeks * 7));
  }
  const step = (gap) => Math.min(250, Math.max(100, roundTo(Math.abs(gap) * 500, 50)));
  const inEarlyWeeks = diffDays(settings.startDate, latest.date) < EARLY_WEEKS_DAYS;

  if (rate > Math.max(maxSafe, needed + 0.5) && !inEarlyWeeks) {
    const target = Math.min(needed, maxSafe);
    return { ...result, status: 'fast', suggestedKcal: settings.kcalTarget + step(rate - target) };
  }
  if (rate < needed - 0.35) {
    if (settings.kcalTarget <= KCAL_FLOOR) return { ...result, status: 'floor' };
    const cappedNeed = Math.min(needed, maxSafe);
    const suggestedKcal = Math.max(KCAL_FLOOR, settings.kcalTarget - step(cappedNeed - rate));
    return { ...result, status: 'slow', suggestedKcal };
  }
  return { ...result, status: 'on-track' };
}

// ---------------------------------------------------------------- calendar file (.ics)

const CRLF = '\r\n';
const encoder = new TextEncoder();

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line so no line is longer than 75 bytes (RFC 5545 3.1). */
function icsFold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(CRLF);
}

function icsDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function icsUtcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Build a calendar file with one repeating event per meal per rotation day,
 * each with an alert at the meal time.
 * Times are "floating" (no time zone), so 12:00 means noon wherever you are.
 */
// The file is public on the site, so it names meals and times but never the
// calorie target or anything else about the person it was made for.
export function buildRemindersICS({
  fromDate,
  untilDate = CONFIG.reminders.until,
  kcalTarget = CONFIG.reminders.planKcal,
  mealTimes = currentTimes,
  stamp = new Date(),
} = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${CONFIG.appName}//Meal reminders//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Meal plan',
    `X-WR-CALDESC:${icsEscape(`Meal reminders from ${CONFIG.appName}.`)}`,
  ];
  const dtstamp = icsUtcStamp(stamp);
  const startRotation = rotationIndex(fromDate);
  let events = 0;

  for (let i = 0; i < ROTATION.length; i += 1) {
    const offset = (((i - startRotation) % ROTATION.length) + ROTATION.length) % ROTATION.length;
    const date = addDays(fromDate, offset);
    if (date > untilDate) continue;
    const plan = planForDate(date, kcalTarget, {}, mealTimes);
    for (const { slot, label, time, meal } of plan.slots) {
      if (!meal) continue;
      const summary = `${label}: ${meal.name}`;
      const description = [
        `About ${formatNumber(meal.kcal)} kcal and ${meal.protein} g protein.`,
        '',
        ...meal.items.map((item) => `- ${ingredientText(item)}`),
        '',
        meal.method,
        '',
        `Log it in ${CONFIG.appName} after you eat.`,
      ].join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:fuel-${String(i).padStart(2, '0')}-${slot}@fuel-meal-plan`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${icsDate(date)}T${time.replace(':', '')}00`,
        'DURATION:PT15M',
        `RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=${icsDate(untilDate)}T235959`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(summary)}`,
        'TRIGGER:PT0S',
        'END:VALARM',
        'END:VEVENT',
      );
      events += 1;
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map(icsFold).join(CRLF) + CRLF, events };
}

/** A short fingerprint of a text (FNV-1a, 32 bits), as 8 hex digits. */
export function fingerprint(textValue) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < textValue.length; i += 1) {
    hash ^= textValue.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Any Monday of a week A: the reminders for rotation day i fall on SIGNATURE_DAY + i.
const SIGNATURE_DAY = '2026-01-05';

/**
 * What the reminders would say, as a fingerprint that does not depend on the
 * day they are made. Two plans with the same fingerprint give the same
 * reminders, so the app can tell when the file on the site is out of date.
 */
export function remindersSignature({ kcalTarget, mealTimes = currentTimes, untilDate }) {
  const { text: body } = buildRemindersICS({
    fromDate: SIGNATURE_DAY,
    untilDate: '2099-12-31',
    kcalTarget,
    mealTimes,
    stamp: new Date(0),
  });
  return `${fingerprint(body)}-${untilDate}`;
}
