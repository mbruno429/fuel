// Prints the nutrition of every meal and the totals of every day in the
// two-week rotation, and flags anything outside the plan's limits.
//
//     node tools/check-plan.mjs            (uses planKcal from js/config.js)
//     node tools/check-plan.mjs 1600       (check another calorie target)

import { readFileSync } from 'node:fs';

import { nutWordIn } from '../js/allergens.js';
import { CONFIG } from '../js/config.js';
import { FOODS } from '../js/foods.js';
import { formatMoney, groceryList, readCatalog } from '../js/grocery.js';
import { MEALS, ROTATION } from '../js/meals.js';
import { addDays, planForDate, rotationIndex } from '../js/core.js';

const target = Number(process.argv[2]) || CONFIG.reminders.planKcal;
const SLOT_RANGE = { breakfast: [360, 440], lunch: [460, 550], dinner: [550, 640] };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let problems = 0;
const flag = (msg) => {
  problems += 1;
  return `  <-- ${msg}`;
};

// Allergen guard: no peanuts or tree nuts anywhere in the plan.
// The word list lives in js/allergens.js. It matches whole words only, so
// "nonstick" or "nutrition" do not trip it.
const nutHits = [];
for (const id of Object.keys(FOODS)) {
  if (nutWordIn(id)) nutHits.push(`food "${id}"`);
}
for (const meal of MEALS) {
  const text = [meal.name, meal.method, ...meal.items.map(([food, , how]) => `${food.replace(/_/g, ' ')} ${how}`)].join(' | ');
  const hit = nutWordIn(text);
  if (hit) nutHits.push(`meal ${meal.id} ("${hit}")`);
}
if (nutHits.length) {
  console.log('NUT CHECK FAILED');
  for (const hit of nutHits) console.log(`  ${hit}${flag('contains or names a nut')}`);
} else {
  console.log('Nut check: no peanuts or tree nuts in any food, ingredient, name or method.');
}

console.log('\nMEALS');
for (const meal of MEALS) {
  let note = '';
  const atwater = meal.protein * 4 + meal.carbs * 4 + meal.fat * 9 - meal.fiber * 2;
  if (Math.abs(atwater - meal.kcal) / meal.kcal > 0.1) note += flag(`macros add up to ${atwater} kcal`);
  const range = SLOT_RANGE[meal.slot];
  if (range && (meal.kcal < range[0] || meal.kcal > range[1])) note += flag(`outside ${range.join('-')} for ${meal.slot}`);
  if (meal.slot !== 'snack' && meal.protein < 30) note += flag('under 30 g protein');
  for (const [food, grams, how] of meal.items) {
    if (!FOODS[food]) note += flag(`unknown food ${food}`);
    if (!(grams > 0) || !how) note += flag(`bad item ${food}`);
  }
  console.log(
    `${meal.id.padEnd(24)} ${String(meal.kcal).padStart(4)} kcal  P${String(meal.protein).padStart(3)}  C${String(meal.carbs).padStart(3)}  F${String(meal.fat).padStart(3)}  fiber${String(meal.fiber).padStart(3)}${note}`,
  );
}

const used = new Set(ROTATION.flatMap((day) => Object.values(day)));
for (const meal of MEALS) {
  if (meal.slot !== 'snack' && !used.has(meal.id)) console.log(`${meal.id}${flag('never used in the rotation')}`);
}

// Find a Monday of week A so the printout starts at rotation day 0.
let start = '2026-11-23';
while (rotationIndex(start) !== 0) start = addDays(start, 1);

console.log(`\nDAYS at a ${target} kcal target`);
let kcalSum = 0;
let proteinSum = 0;
for (let i = 0; i < ROTATION.length; i += 1) {
  const plan = planForDate(addDays(start, i), target);
  kcalSum += plan.kcal;
  proteinSum += plan.protein;
  let note = '';
  // Below about 1,600 the three meals alone fill the day, so these limits only
  // apply from there up.
  if (plan.kcal > target + 40) note += flag('over target');
  if (plan.kcal < target - 100) note += flag('more than 100 under target');
  if (target >= 1650 && plan.protein < 130) note += flag('under 130 g protein');
  const names = plan.slots.map((s) => (s.meal ? `${s.meal.id}(${s.meal.kcal})` : `no ${s.slot}`)).join('  ');
  console.log(
    `${i < 7 ? 'A' : 'B'} ${DAYS[i % 7]}  ${String(plan.kcal).padStart(4)} kcal  P${String(plan.protein).padStart(3)}  C${String(plan.carbs).padStart(3)}  F${String(plan.fat).padStart(3)}  fiber${String(plan.fiber).padStart(3)}  ${names}${note}`,
  );
}
console.log(`\nAverage: ${Math.round(kcalSum / ROTATION.length)} kcal, ${Math.round(proteinSum / ROTATION.length)} g protein a day`);

// The grocery price list: it must read cleanly, buy every ingredient the
// meals use, and name no nut.
console.log('\nGROCERIES');
const priceList = new URL(`../${CONFIG.grocery.priceList.replace(/^\.\//, '')}`, import.meta.url);
const { catalog, problems: listProblems } = readCatalog(JSON.parse(readFileSync(priceList, 'utf8')));
for (const problem of listProblems) console.log(`${problem}${flag('price list')}`);
if (!catalog) {
  console.log(`The price list could not be read.${flag('price list')}`);
} else {
  for (const food of new Set(MEALS.flatMap((meal) => meal.items.map(([name]) => name)))) {
    if (!catalog.itemForFood.has(food)) console.log(`${food}${flag('used by a meal but not bought as anything in the price list')}`);
  }
  const listTexts = [
    ...catalog.stores.flatMap((store) => [store.name, store.brand]),
    ...catalog.items.flatMap((item) => [item.id.replace(/-/g, ' '), item.name, item.as, ...item.typical.map((offer) => offer.label)]),
  ];
  for (const text of listTexts) {
    if (nutWordIn(text)) console.log(`"${text}"${flag('names a nut')}`);
  }
  // What two weeks of this plan cost at the typical prices, bought a week at a time.
  const input = { catalog, storeId: catalog.stores[0].id, start, days: 7, kcalFor: () => target, swaps: {}, logged: {}, servings: 1, prefs: {}, offers: [] };
  const first = groceryList({ ...input, lots: [] });
  const lots = first.lines.map((line, i) => ({ id: String(i), item: line.id, date: start, grams: line.covers, until: line.item.keeps ? null : first.end }));
  const second = groceryList({ ...input, start: addDays(start, 7), lots });
  console.log(`${catalog.items.length} items, ${catalog.stores.length} stores, price list of ${catalog.updated}.`);
  console.log(`Week A from an empty kitchen: ${first.lines.length} items, about ${formatMoney(first.totalCents)} (${formatMoney(first.usedCents)} of it eaten that week).`);
  console.log(`Week B after it:             ${second.lines.length} items, about ${formatMoney(second.totalCents)} (${formatMoney(second.usedCents)} of it eaten that week).`);
}
console.log(problems ? `\n${problems} thing(s) to fix.` : '\nEverything is inside the limits.');
process.exitCode = problems ? 1 : 0;
