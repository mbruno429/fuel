// Run with:  npm test   (or: node --test)

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONFIG } from '../js/config.js';
import { FOODS } from '../js/foods.js';
import { MEALS, ROTATION, mealById } from '../js/meals.js';
import {
  KCAL_FLOOR,
  addDays,
  buildRemindersICS,
  computeTargets,
  dayNumber,
  diffDays,
  formatDay,
  formatTime,
  isValidDate,
  lossPerWeek,
  paceCheck,
  pickSnack,
  planForDate,
  planWeightOn,
  rotationIndex,
  sumEntries,
  targetFor,
  todayStr,
  weekdayIndex,
  withTargets,
} from '../js/core.js';

// ------------------------------------------------------------ dates

test('weekdays and the two-week rotation', () => {
  assert.equal(weekdayIndex('2026-11-25'), 2); // a Wednesday
  assert.equal(weekdayIndex('2026-11-23'), 0); // Monday
  assert.equal(weekdayIndex('2026-11-29'), 6); // Sunday
  assert.equal(formatDay('2026-11-25'), 'Wed, Nov 25');
  assert.equal(formatDay('2027-03-25', { long: true, year: true }), 'Thursday, Mar 25, 2027');

  // Same weekday two weeks apart lands on the same rotation day; one week apart does not.
  for (let i = 0; i < 60; i += 1) {
    const date = addDays('2026-11-23', i);
    assert.equal(rotationIndex(date), rotationIndex(addDays(date, 14)));
    assert.equal(Math.abs(rotationIndex(date) - rotationIndex(addDays(date, 7))), 7);
    assert.equal(rotationIndex(date) % 7, weekdayIndex(date));
  }
  // Every one of the 14 rotation days comes up exactly once in any 14-day run.
  const seen = new Set();
  for (let i = 0; i < 14; i += 1) seen.add(rotationIndex(addDays('2027-01-06', i)));
  assert.equal(seen.size, 14);
});

test('day arithmetic is not thrown by daylight saving or year ends', () => {
  assert.equal(diffDays('2026-11-25', '2027-03-25'), 120);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-13', 1), '2027-03-14'); // US clocks change on the 14th
  assert.equal(addDays('2027-03-14', 1), '2027-03-15');
  assert.equal(diffDays('2027-03-13', '2027-03-15'), 2);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // leap year
  assert.equal(dayNumber('1970-01-01'), 0);
  assert.ok(isValidDate('2027-02-28'));
  assert.ok(!isValidDate('2027-02-30'));
  assert.ok(!isValidDate('tomorrow'));
  assert.equal(todayStr(new Date(2026, 10, 25, 23, 59)), '2026-11-25');
  assert.equal(todayStr(new Date(2026, 10, 26, 0, 1)), '2026-11-26');
  assert.equal(formatTime('07:30'), '7:30 AM');
  assert.equal(formatTime('12:00'), '12:00 PM');
  assert.equal(formatTime('00:05'), '12:05 AM');
  assert.equal(formatTime('18:30'), '6:30 PM');
});

// ------------------------------------------------------------ targets

// An example person, used throughout: BMR 1,900, 230 lb now, 200 lb in 120 days.
const EXAMPLE = { bmr: 1900, weight: 230, goalWeight: 200, targetDate: '2027-03-25' };
const DAY_ONE = '2026-11-25';

test('targets for the example person', () => {
  const t = computeTargets(EXAMPLE, DAY_ONE);
  assert.equal(t.daysLeft, 120);
  assert.equal(t.requiredDeficit, 875); // 30 lb x 3500 / 120 days
  assert.equal(t.burn, 2945); // BMR x 1.55
  assert.equal(t.kcal, 2050); // 2945 - 875 = 2070, to the nearest 50
  assert.equal(t.protein, 145); // 1.6 g per kg of a 200 lb goal
  assert.equal(t.limitedBy, null);
  assert.equal(t.usedWatchAverage, false);
  assert.ok(Math.abs(t.lbPerWeek - 1.79) < 0.01);
  assert.ok(t.projectedLoss > 30);

  // With a watch average: burn = BMR + Move + 10% of intake.
  assert.equal(computeTargets({ ...EXAMPLE, activeKcal: 600 }, DAY_ONE).kcal, 1800);
  assert.equal(computeTargets({ ...EXAMPLE, activeKcal: 800 }, DAY_ONE).kcal, 2050);
  assert.equal(computeTargets({ ...EXAMPLE, activeKcal: 1000 }, DAY_ONE).kcal, 2250);
  assert.equal(computeTargets({ ...EXAMPLE, activeKcal: 800 }, DAY_ONE).usedWatchAverage, true);
});

test('the target never drops under the floor or chases an extreme pace', () => {
  // Low activity: the sum would be under 1,500, so the floor holds and says so.
  const low = computeTargets({ ...EXAMPLE, activeKcal: 200 }, DAY_ONE);
  assert.equal(low.kcal, KCAL_FLOOR);
  assert.equal(low.limitedBy, 'floor');
  assert.ok(low.projectedLoss < 30);

  // An impossible goal: 60 lb in 60 days. The deficit is capped at 1,100 kcal.
  const rushed = computeTargets({ bmr: 2200, weight: 260, goalWeight: 200, targetDate: '2027-01-24', activeKcal: 1200 }, DAY_ONE);
  assert.equal(rushed.limitedBy, 'pace');
  assert.ok(rushed.deficit <= 1125);
  assert.ok(rushed.kcal >= KCAL_FLOOR);

  // A goal at or above the current weight asks for no deficit at all.
  const hold = computeTargets({ ...EXAMPLE, goalWeight: 230 }, DAY_ONE);
  assert.equal(hold.requiredDeficit, 0);
  assert.equal(hold.kcal, 2950);

  // No silly numbers for any reasonable input.
  for (const bmr of [1200, 1500, 1900, 2400]) {
    for (const activeKcal of [0, 200, 600, 1200]) {
      for (const days of [14, 60, 120, 365]) {
        const t = computeTargets({ bmr, weight: 230, goalWeight: 190, targetDate: addDays(DAY_ONE, days), activeKcal }, DAY_ONE);
        assert.ok(t.kcal >= KCAL_FLOOR, `floor held for bmr ${bmr}, active ${activeKcal}, ${days} days`);
        assert.ok(t.kcal % 50 === 0);
        assert.ok(t.deficit <= 1130, `deficit ${t.deficit} stays near the cap`);
      }
    }
  }
});

// ------------------------------------------------------------ meals and plan

test('no peanuts or tree nuts anywhere in the plan', () => {
  const nutWords = /\b(nuts?|peanuts?|almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamia|brazil|pine|praline|marzipan|nougat|pesto|satay|nutella|granola|trail)\b/i;
  for (const id of Object.keys(FOODS)) assert.ok(!nutWords.test(id.replace(/_/g, ' ')), `food ${id}`);
  for (const meal of MEALS) {
    const text = [meal.name, meal.method, ...meal.items.map(([food, , how]) => `${food.replace(/_/g, ' ')} ${how}`)].join(' | ');
    assert.ok(!nutWords.test(text), `${meal.id}: ${text}`);
  }
  // The guard itself works.
  assert.ok(nutWords.test('16 almonds'));
  assert.ok(nutWords.test('1 tbsp peanut butter'));
  assert.ok(nutWords.test('pine nuts'));
  assert.ok(!nutWords.test('fried in a nonstick pan with nutmeg and pineapple'));
});

test('every meal is well formed and every rotation day points at real meals', () => {
  const ids = new Set();
  for (const meal of MEALS) {
    assert.ok(!ids.has(meal.id), `duplicate id ${meal.id}`);
    ids.add(meal.id);
    assert.ok(['breakfast', 'lunch', 'dinner', 'snack'].includes(meal.slot));
    assert.ok(meal.items.length > 0 && meal.method && meal.name);
    for (const [food, grams, how] of meal.items) {
      assert.ok(FOODS[food], `${meal.id} uses unknown food ${food}`);
      assert.ok(grams > 0 && typeof how === 'string' && how.length > 2);
    }
    assert.ok(meal.kcal > 0 && meal.kcal % 5 === 0);
    // Calories should roughly match the macros (4/4/9, fiber counted at 2).
    const fromMacros = meal.protein * 4 + meal.carbs * 4 + meal.fat * 9 - meal.fiber * 2;
    assert.ok(Math.abs(fromMacros - meal.kcal) / meal.kcal < 0.1, `${meal.id}: ${meal.kcal} vs ${fromMacros}`);
  }
  assert.equal(ROTATION.length, 14);
  for (const day of ROTATION) {
    for (const slot of ['breakfast', 'lunch', 'dinner']) {
      assert.equal(mealById(day[slot]).slot, slot);
    }
  }
});

test('daily plans land on the target and carry enough protein', () => {
  for (const target of [1650, 1700, 1800, 1900, 2000, 2100, 2200]) {
    for (let i = 0; i < 14; i += 1) {
      const plan = planForDate(addDays('2026-11-30', i), target);
      assert.ok(plan.kcal <= target + 40, `${target}: day ${i} is ${plan.kcal}`);
      assert.ok(plan.kcal >= target - 100, `${target}: day ${i} is ${plan.kcal}`);
      assert.ok(plan.protein >= 130, `${target}: day ${i} has ${plan.protein} g protein`);
      const sum = plan.slots.reduce((total, s) => total + (s.meal ? s.meal.kcal : 0), 0);
      assert.equal(sum, plan.kcal);
    }
  }
  // At 1,800 the day is breakfast, lunch, snack, dinner in clock order.
  const plan = planForDate('2026-11-25', 1800);
  assert.deepEqual(plan.slots.map((s) => s.slot), ['breakfast', 'lunch', 'snack', 'dinner']);
  // At the floor the three meals fill the day and the snack drops out.
  const floor = planForDate('2026-11-25', 1500);
  assert.equal(floor.slots.find((s) => s.slot === 'snack').meal, null);
  // High targets add a morning snack, and the two snacks differ.
  const high = planForDate('2026-11-25', 2200);
  assert.deepEqual(high.slots.map((s) => s.slot), ['breakfast', 'morningSnack', 'lunch', 'snack', 'dinner']);
  const [a, b] = high.slots.filter((s) => s.slot.toLowerCase().includes('snack')).map((s) => s.meal.id);
  assert.notEqual(a, b);
});

test('swaps', () => {
  const date = '2026-11-25';
  const base = planForDate(date, 1800);
  const lunch = base.slots.find((s) => s.slot === 'lunch').meal;
  const other = MEALS.find((m) => m.slot === 'lunch' && m.id !== lunch.id);

  const swapped = planForDate(date, 1800, { lunch: other.id });
  assert.equal(swapped.slots.find((s) => s.slot === 'lunch').meal.id, other.id);
  assert.equal(swapped.slots.find((s) => s.slot === 'lunch').swapped, true);
  assert.ok(swapped.kcal <= 1840 && swapped.kcal >= 1700); // the snack re-fits

  // A dinner id in the lunch slot, or an unknown id, is ignored.
  const dinner = MEALS.find((m) => m.slot === 'dinner');
  assert.equal(planForDate(date, 1800, { lunch: dinner.id }).slots.find((s) => s.slot === 'lunch').meal.id, lunch.id);
  assert.equal(planForDate(date, 1800, { lunch: 'nope' }).slots.find((s) => s.slot === 'lunch').meal.id, lunch.id);

  // Skipping the snack.
  const skipped = planForDate(date, 1800, { snack: 'none' });
  assert.equal(skipped.slots.find((s) => s.slot === 'snack').meal, null);
  assert.equal(skipped.slots.find((s) => s.slot === 'snack').swapped, true);
  assert.equal(skipped.kcal, base.kcal - base.slots.find((s) => s.slot === 'snack').meal.kcal);
});

test('snack picker', () => {
  assert.equal(pickSnack(20, 0), null);
  for (const budget of [90, 150, 220, 300, 380, 450]) {
    for (let rot = 0; rot < 14; rot += 1) {
      const snack = pickSnack(budget, rot);
      assert.ok(snack, `budget ${budget}`);
      assert.ok(snack.kcal <= budget + 25);
      assert.ok(!snack.manualOnly);
    }
  }
  // It rotates rather than repeating one snack.
  const picks = new Set();
  for (let rot = 0; rot < 14; rot += 1) picks.add(pickSnack(300, rot).id);
  assert.ok(picks.size >= 3);
  assert.equal(sumEntries([{ kcal: 500, protein: 40 }, { kcal: '120', protein: undefined }]).kcal, 620);
});

// ------------------------------------------------------------ weight

const settings = {
  bmr: 1900, startWeight: 230, goalWeight: 200, startDate: DAY_ONE, targetDate: '2027-03-25',
  activeKcal: null, kcalTarget: 2050, proteinTarget: 145, targetChangedOn: null,
};

function weighIns(startDate, startLb, lbPerWeek, days, every = 2) {
  const out = [];
  for (let d = 0; d <= days; d += every) out.push({ date: addDays(startDate, d), lb: startLb - (lbPerWeek * d) / 7 });
  return out;
}

test('plan line and trend', () => {
  assert.equal(planWeightOn(DAY_ONE, settings), 230);
  assert.equal(planWeightOn('2027-03-25', settings), 200);
  assert.equal(planWeightOn('2027-01-24', settings), 215); // halfway
  assert.equal(planWeightOn('2027-06-01', settings), 200);
  assert.equal(planWeightOn('2026-01-01', settings), 230);
  assert.ok(Math.abs(lossPerWeek(weighIns(DAY_ONE, 230, 2, 28)) - 2) < 1e-9);
  assert.equal(lossPerWeek([{ date: DAY_ONE, lb: 230 }]), null);
});

test('pace check', () => {
  assert.equal(paceCheck([], settings).status, 'no-data');
  assert.equal(paceCheck([{ date: DAY_ONE, lb: 230 }], settings).status, 'early');
  assert.equal(paceCheck(weighIns(DAY_ONE, 230, 2, 10), settings).status, 'early');

  // About the 1.75 lb a week the goal needs, five weeks in.
  const steady = paceCheck(weighIns(DAY_ONE, 230, 1.8, 35), settings);
  assert.equal(steady.status, 'on-track');
  assert.ok(Math.abs(steady.rate - 1.8) < 1e-6);

  // Losing 1 lb a week: suggest fewer calories, at most 250 fewer, never under the floor.
  const slow = paceCheck(weighIns(DAY_ONE, 230, 1.0, 35), settings);
  assert.equal(slow.status, 'slow');
  assert.ok(slow.suggestedKcal < 2050 && slow.suggestedKcal >= KCAL_FLOOR);
  assert.ok(2050 - slow.suggestedKcal <= 250);
  assert.equal(paceCheck(weighIns(DAY_ONE, 230, 1.0, 35), { ...settings, kcalTarget: 1600 }).suggestedKcal, KCAL_FLOOR);

  // Already at the floor: no lower suggestion, but a projected date.
  const floor = paceCheck(weighIns(DAY_ONE, 230, 1.0, 35), { ...settings, kcalTarget: KCAL_FLOOR });
  assert.equal(floor.status, 'floor');
  assert.equal(floor.suggestedKcal, undefined);
  assert.ok(floor.projectedDate > settings.targetDate);

  // Losing 3.2 lb a week after the early weeks: suggest more.
  const fast = paceCheck(weighIns(DAY_ONE, 230, 3.2, 35), settings);
  assert.equal(fast.status, 'fast');
  assert.ok(fast.suggestedKcal > 2050 && fast.suggestedKcal <= 2300);

  // The same speed in the first three weeks is not flagged (water weight).
  assert.equal(paceCheck(weighIns(DAY_ONE, 230, 3.2, 16), settings).status, 'on-track');

  // After a target change the check waits for two weeks of new weigh-ins.
  const changed = { ...settings, kcalTarget: 1900, targetChangedOn: '2026-12-28' };
  assert.equal(paceCheck(weighIns(DAY_ONE, 230, 1.0, 40), changed).status, 'early');

  assert.equal(paceCheck([{ date: '2027-03-01', lb: 199.5 }], settings).status, 'reached');
});

test('a new target applies from the day it is set, not to earlier days', () => {
  const day1 = { ...settings, targets: [{ from: DAY_ONE, kcal: 2050, protein: 145 }] };
  assert.deepEqual(targetFor(day1, DAY_ONE), { kcal: 2050, protein: 145 });
  assert.deepEqual(targetFor(day1, '2026-01-01'), { kcal: 2050, protein: 145 }); // before the start
  assert.deepEqual(targetFor(settings, '2026-12-25'), { kcal: 2050, protein: 145 }); // no history saved

  const later = withTargets(day1, 1900, 145, '2026-12-20');
  assert.equal(later.kcalTarget, 1900);
  assert.equal(later.targetChangedOn, '2026-12-20');
  assert.equal(later.targets.length, 2);
  assert.equal(targetFor(later, '2026-12-19').kcal, 2050);
  assert.equal(targetFor(later, '2026-12-20').kcal, 1900);
  assert.equal(targetFor(later, '2027-02-01').kcal, 1900);
  assert.equal(day1.targets.length, 1, 'the original settings are not modified');

  // A second change on the same day replaces that day's entry instead of stacking up.
  const again = withTargets(later, 1950, 150, '2026-12-20');
  assert.equal(again.targets.length, 2);
  assert.deepEqual(targetFor(again, '2026-12-21'), { kcal: 1950, protein: 150 });
  assert.equal(targetFor(again, '2026-12-01').kcal, 2050);

  // Saving the same numbers changes nothing; changing only protein does not reset the pace check.
  const same = withTargets(again, 1950, 150, '2026-12-28');
  assert.equal(same.targets.length, 2);
  assert.equal(same.targetChangedOn, '2026-12-20');
  const protein = withTargets(again, 1950, 155, '2026-12-28');
  assert.equal(protein.targets.length, 3);
  assert.equal(protein.targetChangedOn, '2026-12-20');

  // Changing the target on the very first day rewrites that day, with no second entry.
  const firstDay = withTargets(day1, 2000, 145, DAY_ONE);
  assert.equal(firstDay.targets.length, 1);
  assert.equal(targetFor(firstDay, DAY_ONE).kcal, 2000);
});

// ------------------------------------------------------------ calendar file

function unfold(text) {
  return text.replace(/\r\n /g, '').split('\r\n');
}

test('calendar file is valid iCalendar', () => {
  const stamp = new Date(Date.UTC(2026, 10, 25, 21, 0, 0));
  const { text, events } = buildRemindersICS({ fromDate: '2026-11-25', untilDate: '2027-03-31', kcalTarget: 1800, stamp });
  assert.equal(events, 56); // 14 rotation days x 4 meals

  // Lines end in CRLF and none is longer than 75 bytes.
  assert.ok(text.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'bare line feed found');
  for (const line of text.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `too long: ${line}`);
  }

  const lines = unfold(text);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines[1], 'VERSION:2.0');
  assert.equal(lines[lines.length - 2], 'END:VCALENDAR');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 56);
  assert.equal(lines.filter((l) => l === 'END:VEVENT').length, 56);
  assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 56);
  assert.equal(lines.filter((l) => l === 'TRIGGER:PT0S').length, 56);
  assert.equal(new Set(lines.filter((l) => l.startsWith('UID:'))).size, 56);
  assert.equal(lines.filter((l) => l === 'DTSTAMP:20261125T210000Z').length, 56);

  // Each event starts on the first date of its rotation day, at the configured time.
  const starts = lines.filter((l) => l.startsWith('DTSTART:')).map((l) => l.slice(8));
  const times = new Set(starts.map((s) => s.slice(9)));
  assert.deepEqual([...times].sort(), ['073000', '120000', '153000', '183000']);
  const dates = [...new Set(starts.map((s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`))].sort();
  assert.equal(dates.length, 14);
  assert.equal(dates[0], '2026-11-25');
  assert.equal(dates[13], '2026-12-08');
  for (const l of lines.filter((x) => x.startsWith('RRULE:'))) {
    assert.equal(l, 'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20270331T235959');
  }

  // The reminder for a date names the meal the app shows for that date.
  const plan = planForDate('2026-12-03', 1800);
  const dinner = plan.slots.find((s) => s.slot === 'dinner').meal;
  const index = lines.indexOf('DTSTART:20261203T183000');
  assert.ok(index > 0);
  const event = lines.slice(index - 3, index + 12).join('\n');
  assert.ok(event.includes(`SUMMARY:Dinner: ${dinner.name}`.replace(/,/g, '\\,')), event);

  // Commas, semicolons and line breaks in text are escaped.
  for (const l of lines.filter((x) => x.startsWith('SUMMARY:') || x.startsWith('DESCRIPTION:'))) {
    assert.ok(!/(^|[^\\])[,;]/.test(l.slice(l.indexOf(':') + 1)), `unescaped: ${l}`);
  }
});

test('calendar file respects the last day and other targets', () => {
  // Only six days left: rotation days that first fall after the last day are left out.
  const short = buildRemindersICS({ fromDate: '2027-03-26', untilDate: '2027-03-31', kcalTarget: 1800 });
  assert.equal(short.events, 24);
  // A 2,200 kcal day has a morning snack, so five reminders a day.
  const high = buildRemindersICS({ fromDate: '2026-11-25', untilDate: '2027-03-31', kcalTarget: 2200 });
  assert.equal(high.events, 70);
  assert.ok(high.text.includes('T100000'));
  // Defaults come from js/config.js.
  const byDefault = buildRemindersICS({ fromDate: '2026-11-25' });
  assert.ok(byDefault.text.includes(`UNTIL=${CONFIG.reminders.until.replace(/-/g, '')}T235959`));
});
