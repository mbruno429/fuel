// Rebuilds meal-reminders.ics from the meal times and plan in js/.
//
//     node tools/build-reminders.mjs
//
// Options (all optional):
//     --from 2026-12-01     first day of reminders (default: today)
//     --until 2027-03-31    last day they repeat (default: reminders.until in js/config.js)
//     --kcal 1700           calorie target to pick snacks for (default: reminders.planKcal)
//     --out some/file.ics   where to write (default: meal-reminders.ics in the repo root)
//
// Commit the new file, then add it to your calendar again. If you put the old
// reminders in their own calendar, delete that calendar first.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';
import { buildRemindersICS, formatTime, isValidDate, orderedSlots, todayStr } from '../js/core.js';

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const fromDate = option('from', todayStr());
const untilDate = option('until', CONFIG.reminders.until);
const kcalTarget = Number(option('kcal', CONFIG.reminders.planKcal));
const out = option('out', fileURLToPath(new URL('../meal-reminders.ics', import.meta.url)));

if (!isValidDate(fromDate) || !isValidDate(untilDate)) {
  console.error('Dates must look like 2026-12-01.');
  process.exit(1);
}
if (untilDate < fromDate) {
  console.error(`The last day (${untilDate}) is before the first day (${fromDate}). Change reminders.until in js/config.js or pass --until.`);
  process.exit(1);
}
if (!(kcalTarget >= 1500 && kcalTarget <= 5000)) {
  console.error('The calorie target should be between 1500 and 5000.');
  process.exit(1);
}

const { text, events } = buildRemindersICS({ fromDate, untilDate, kcalTarget });
writeFileSync(out, text);

const times = orderedSlots()
  .filter((slot) => slot !== 'morningSnack' || text.includes('SUMMARY:Morning snack'))
  .map((slot) => formatTime(CONFIG.mealTimes[slot]))
  .join(', ');
console.log(`Wrote ${out}`);
console.log(`${events} repeating reminders from ${fromDate} to ${untilDate}, at ${times}, for a ${kcalTarget} kcal day.`);
