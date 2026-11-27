// Run with:  npm test   (or: node --test)
//
// Changes made in the app: meal times, meals, the two-week menu, typical
// prices, hidden stores, and updating the reminders file on GitHub.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { nutWordIn } from '../js/allergens.js';
import { CONFIG } from '../js/config.js';
import {
  addDays,
  buildRemindersICS,
  fingerprint,
  getMealTimes,
  isValidTime,
  orderedSlots,
  pickSnack,
  planForDate,
  remindersSignature,
  rotationIndex,
  setMealTimes,
} from '../js/core.js';
import { FOODS, FOOD_NAMES } from '../js/foods.js';
import { fitBudget, groceryList, findStore, readCatalog, shownStores, withTypical } from '../js/grocery.js';
import {
  BASE_MEALS,
  BASE_ROTATION,
  MEALS,
  ROTATION,
  applyMealChanges,
  baseMeal,
  cleanFacts,
  cleanItems,
  ingredientText,
  mealById,
  mealsForSlot,
  mealsVersion,
  nutritionFor,
} from '../js/meals.js';
import {
  NEW_KEY_URL,
  PublishError,
  calendarUrls,
  checkKey,
  fromBase64,
  guessRepo,
  isClassicKey,
  isRepoName,
  looksLikeKey,
  publishFile,
  sameCalendar,
  toBase64,
} from '../js/publish.js';

const WED = '2026-11-25'; // rotation day 2: yogurt bowl, turkey chili, salmon
const { catalog } = readCatalog(JSON.parse(readFileSync(new URL('../data/groceries.json', import.meta.url), 'utf8')));

/** Run a test body with some meal changes in force, and always put the built-in meals back. */
function withMeals(changes, fn) {
  applyMealChanges(changes);
  try {
    return fn();
  } finally {
    applyMealChanges();
  }
}

function withTimes(times, fn) {
  setMealTimes(times);
  try {
    return fn();
  } finally {
    setMealTimes();
  }
}

// ------------------------------------------------------------ foods and meals

test('every food has a name on screen, and no name mentions a nut', () => {
  assert.deepEqual(Object.keys(FOOD_NAMES).sort(), Object.keys(FOODS).sort());
  for (const name of Object.values(FOOD_NAMES)) assert.equal(nutWordIn(name), null, name);
});

test('with no changes, the meals and menu are the built-in ones', () => {
  applyMealChanges();
  assert.equal(MEALS.length, BASE_MEALS.length);
  for (const meal of MEALS) {
    assert.equal(meal, baseMeal(meal.id), `${meal.id} is the built-in object`);
    assert.equal(meal.origin, 'built-in');
  }
  assert.deepEqual(ROTATION, BASE_ROTATION.map((day) => ({ ...day })));
  assert.ok(Object.isFrozen(MEALS[0]) && Object.isFrozen(MEALS[0].items) && Object.isFrozen(MEALS[0].items[0]));
});

test('changing the amounts in a meal changes its numbers everywhere, and can be undone', () => {
  const before = mealById('b-yogurt');
  assert.equal(before.kcal, 385);
  const version = mealsVersion();
  withMeals({ edits: { 'b-yogurt': { items: [['greek_yogurt', 300, ''], ['blueberries', 100, '⅔ cup blueberries'], ['oats', 27, '⅓ cup rolled oats']] } } }, () => {
    assert.ok(mealsVersion() > version);
    const meal = mealById('b-yogurt');
    assert.equal(meal.origin, 'changed');
    assert.equal(meal.name, 'Greek yogurt power bowl'); // unchanged parts stay
    assert.equal(meal.method, before.method);
    const expected = nutritionFor(meal.items);
    assert.equal(meal.kcal, expected.kcal);
    assert.equal(meal.kcal, 335); // 177 + 57 + 102 = 336, rounded to 5
    assert.equal(baseMeal('b-yogurt').kcal, 385, 'the built-in version is kept');
    // The plan for a Wednesday of week A uses it.
    const plan = planForDate(WED, 1800);
    assert.equal(plan.slots.find((s) => s.slot === 'breakfast').meal, meal);
    // The recipe line for a changed amount reads in grams.
    assert.equal(ingredientText(meal.items[0]), '300 g Greek yogurt, nonfat plain');
    assert.equal(ingredientText(meal.items[1]), '⅔ cup blueberries');
    assert.equal(ingredientText(['olive_oil', 4.5, '']), '4.5 g Olive oil');
  });
  assert.equal(mealById('b-yogurt').kcal, 385, 'back to the built-in meal');
});

test('a changed meal with nothing usable in it keeps its built-in ingredients', () => {
  withMeals({ edits: { 'b-oats': { name: 'Night oats', items: [['unicorn', 50, ''], ['oats', -4, '']] } } }, () => {
    const meal = mealById('b-oats');
    assert.equal(meal.name, 'Night oats');
    assert.deepEqual(meal.items, baseMeal('b-oats').items);
    assert.equal(meal.kcal, baseMeal('b-oats').kcal);
  });
  const { problems } = applyMealChanges({ edits: { 'b-oats': { items: [] } } });
  assert.equal(problems.length, 1);
  applyMealChanges();
});

test('ingredients and typed-in numbers are checked', () => {
  assert.deepEqual(cleanItems([['oats', '40', ' ½ cup '], ['oats', 0, ''], ['nope', 5, ''], ['whey', 2001, ''], 'x', ['egg', 50.04, 7]]), [
    ['oats', 40, '½ cup'],
    ['egg', 50, ''],
  ]);
  assert.equal(cleanItems(Array.from({ length: 40 }, () => ['egg', 50, ''])).length, 30);
  assert.deepEqual(cleanFacts({ kcal: '640', protein: 42.4, carbs: '', fat: 20 }), { kcal: 640, protein: 42, carbs: 0, fat: 20, fiber: 0 });
  assert.equal(cleanFacts({ kcal: 0 }), null);
  assert.equal(cleanFacts({ kcal: 5000 }), null);
  assert.equal(cleanFacts({ kcal: 400, protein: -1 }), null);
  assert.equal(cleanFacts({ protein: 30 }), null);
  assert.equal(cleanFacts(null), null);
});

test('meals of your own: from ingredients or from numbers', () => {
  const added = [
    { id: 'my-steak-salad', slot: 'dinner', name: 'Steak salad', items: [['sirloin_raw', 170, ''], ['salad_greens', 100, ''], ['olive_oil', 9, '2 tsp olive oil']], method: 'Grill, slice, toss.' },
    { id: 'my-chipotle-bowl', slot: 'lunch', name: 'Chipotle chicken bowl', facts: { kcal: 780, protein: 52, carbs: 80, fat: 24 } },
    { id: 'my-chipotle-bowl', slot: 'lunch', name: 'Same id again', facts: { kcal: 700 } },
    { id: 'b-oats', slot: 'breakfast', name: 'Takes a built-in id', facts: { kcal: 300 } },
    { id: 'my-nameless', slot: 'lunch', name: '  ', facts: { kcal: 300 } },
    { id: 'my-brunch', slot: 'brunch', name: 'No such meal', facts: { kcal: 300 } },
    { id: 'my-empty', slot: 'snack', name: 'Nothing in it', items: [], facts: { kcal: 0 } },
    { id: 'my-both', slot: 'snack', name: 'Ingredients win', items: [['apple', 182, '']], facts: { kcal: 999, protein: 99 } },
  ];
  const { problems } = applyMealChanges({ added });
  try {
    assert.equal(problems.length, 5);
    const salad = mealById('my-steak-salad');
    assert.equal(salad.origin, 'yours');
    assert.equal(salad.numbersOnly, false);
    assert.equal(salad.kcal, nutritionFor(salad.items).kcal);
    const bowl = mealById('my-chipotle-bowl');
    assert.deepEqual([bowl.kcal, bowl.protein, bowl.carbs, bowl.fat, bowl.fiber, bowl.numbersOnly], [780, 52, 80, 24, 0, true]);
    assert.deepEqual(bowl.items, []);
    assert.equal(mealById('b-oats').origin, 'built-in');
    const both = mealById('my-both');
    assert.deepEqual([both.kcal, both.numbersOnly, both.items.length], [nutritionFor([['apple', 182]]).kcal, false, 1], 'ingredients beat typed totals');
    assert.equal(MEALS.length, BASE_MEALS.length + 3);
    assert.ok(mealsForSlot('dinner').includes(salad));
    // Yours come after the built-in meals, in the order they were added.
    assert.deepEqual(MEALS.slice(-3).map((m) => m.id), ['my-steak-salad', 'my-chipotle-bowl', 'my-both']);
  } finally {
    applyMealChanges();
  }
  assert.equal(mealById('my-steak-salad'), null);
});

test('the two-week menu can be changed cell by cell', () => {
  const salad = { id: 'my-steak-salad', slot: 'dinner', name: 'Steak salad', items: [['sirloin_raw', 170, ''], ['salad_greens', 100, '']] };
  const { problems } = applyMealChanges({
    added: [salad],
    menu: {
      2: { dinner: 'my-steak-salad', lunch: 'l-bowl' },
      9: { breakfast: 'd-tacos' }, // a dinner at breakfast
      13: { lunch: 'my-unknown' },
    },
  });
  try {
    assert.equal(problems.length, 2);
    assert.deepEqual(ROTATION[2], { breakfast: 'b-yogurt', lunch: 'l-bowl', dinner: 'my-steak-salad' });
    assert.deepEqual(ROTATION[9], BASE_ROTATION[9]);
    assert.deepEqual(ROTATION[13], BASE_ROTATION[13]);
    assert.equal(rotationIndex(WED), 2);
    const plan = planForDate(WED, 1800);
    assert.equal(plan.slots.find((s) => s.slot === 'dinner').meal.id, 'my-steak-salad');
    assert.equal(plan.slots.find((s) => s.slot === 'lunch').meal.id, 'l-bowl');
    // Two weeks later is the same rotation day; one week later is not.
    assert.equal(planForDate(addDays(WED, 14), 1800).slots.find((s) => s.slot === 'dinner').meal.id, 'my-steak-salad');
    assert.equal(planForDate(addDays(WED, 7), 1800).slots.find((s) => s.slot === 'dinner').meal.id, BASE_ROTATION[9].dinner);
    // A swap for one day still wins over the menu.
    assert.equal(planForDate(WED, 1800, { dinner: 'd-cod' }).slots.find((s) => s.slot === 'dinner').meal.id, 'd-cod');
  } finally {
    applyMealChanges();
  }
  assert.deepEqual(ROTATION[2], BASE_ROTATION[2]);
});

test('snacks can be kept out of the automatic picks, or let into them', () => {
  const picks = () => new Set(Array.from({ length: 14 }, (_, i) => planForDate(addDays(WED, i), 1800).slots.find((s) => s.slot === 'snack').meal.id));
  const usual = picks();
  const favourite = [...usual][0];
  withMeals({ auto: { [favourite]: false } }, () => {
    assert.ok(!picks().has(favourite), `${favourite} is no longer picked`);
    for (let budget = 100; budget <= 700; budget += 25) {
      for (let r = 0; r < 14; r += 1) {
        const snack = pickSnack(budget, r);
        assert.ok(!snack || snack.id !== favourite);
      }
    }
  });
  assert.ok(picks().has(favourite), 'picked again once the change is gone');
  // The apple is manual-only out of the box; it can be let in.
  assert.equal(mealById('s-apple').manualOnly, true);
  withMeals({ auto: { 's-apple': true } }, () => {
    assert.equal(mealById('s-apple').manualOnly, false);
    let seen = false;
    for (let r = 0; r < 14 && !seen; r += 1) seen = pickSnack(mealById('s-apple').kcal, r)?.id === 's-apple';
    assert.ok(seen, 'the apple can now be picked');
  });
});

// ------------------------------------------------------------ meal times

test('meal times come from settings, with the configured ones as a fallback', () => {
  assert.deepEqual(getMealTimes(), CONFIG.mealTimes);
  assert.ok(isValidTime('07:05') && isValidTime('23:59'));
  assert.ok(!isValidTime('7:05') && !isValidTime('24:00') && !isValidTime('12:60') && !isValidTime(null));
  withTimes({ breakfast: '06:45', lunch: '13:15', dinner: 'seven', snack: '21:00' }, () => {
    const times = getMealTimes();
    assert.deepEqual(times, { ...CONFIG.mealTimes, breakfast: '06:45', lunch: '13:15', snack: '21:00' });
    times.breakfast = '01:00';
    assert.equal(getMealTimes().breakfast, '06:45', 'a copy, not the real thing');
    // Slots go in time order, so a late snack comes after dinner.
    assert.deepEqual(orderedSlots(), ['breakfast', 'morningSnack', 'lunch', 'dinner', 'snack']);
    const plan = planForDate(WED, 1800);
    assert.deepEqual(plan.slots.map((s) => `${s.slot}@${s.time}`), ['breakfast@06:45', 'lunch@13:15', 'dinner@18:30', 'snack@21:00']);
  });
  assert.deepEqual(getMealTimes(), CONFIG.mealTimes);
});

// ------------------------------------------------------------ the reminders file

test('the reminders follow the times, meals and menu, and never state the calorie target', () => {
  const kcal = 2100;
  withTimes({ lunch: '12:45' }, () => withMeals({ edits: { 'l-chili': { items: [['turkey_93_raw', 200, ''], ['beans', 115, ''], ['canned_tomatoes', 200, '']] } } }, () => {
    const { text, events } = buildRemindersICS({ fromDate: WED, untilDate: '2027-03-25', kcalTarget: kcal, stamp: new Date(Date.UTC(2026, 10, 27)) });
    assert.ok(events >= 56);
    assert.ok(!/2,?100/.test(text), 'the target is not in the file');
    assert.ok(!/kcal a day|built for/i.test(text));
    assert.ok(text.includes('X-WR-CALDESC:Meal reminders from Fuel.'));
    // Wednesday of week A: lunch at 12:45, with the changed chili listed in grams.
    const unfolded = text.replace(/\r\n[ \t]/g, '');
    const lunch = unfolded.split('BEGIN:VEVENT').find((event) => event.includes('UID:fuel-02-lunch@'));
    assert.ok(lunch.includes('DTSTART:20261125T124500'));
    assert.ok(lunch.includes('- 200 g Ground turkey 93% lean\\, raw'), lunch);
  }));
});

test('the reminders fingerprint ignores the day it is made and catches every real change', (t) => {
  const base = { kcalTarget: 1800, untilDate: '2027-03-25' };
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-27T18:00:00Z') });
  const friday = remindersSignature(base);
  t.mock.timers.setTime(new Date('2026-12-08T18:00:00Z').getTime());
  assert.equal(remindersSignature(base), friday, 'made on another day, the same plan gives the same fingerprint');
  t.mock.timers.reset();
  const start = remindersSignature(base);
  assert.equal(start, friday);
  assert.match(start, /^[0-9a-f]{8}-2027-03-25$/);
  assert.equal(remindersSignature(base), start);
  // The file made today and the file made next week say the same things.
  const strip = (from) => buildRemindersICS({ fromDate: from, untilDate: '2099-12-31', kcalTarget: 1800, stamp: new Date(0) }).text
    .replace(/\r\n[ \t]/g, '').split('\r\n').filter((line) => !line.startsWith('DTSTART')).sort().join('\n');
  assert.equal(strip(WED), strip(addDays(WED, 9)));

  assert.notEqual(remindersSignature({ ...base, untilDate: '2027-04-30' }), start);
  withTimes({ dinner: '19:00' }, () => assert.notEqual(remindersSignature(base), start));
  withTimes({ morningSnack: '09:00' }, () => assert.equal(remindersSignature(base), start, 'no morning snack at 1,800 kcal, so its time changes nothing'));
  withMeals({ menu: { 4: { dinner: 'd-cod' } } }, () => assert.notEqual(remindersSignature(base), start));
  withMeals({ edits: { 'd-salmon': { name: 'Lemon salmon' } } }, () => assert.notEqual(remindersSignature(base), start));
  // A higher target picks other snacks and adds morning snacks.
  assert.notEqual(remindersSignature({ ...base, kcalTarget: 2200 }), start);
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
});

// ------------------------------------------------------------ groceries

test('a typical price set in the app replaces the price list, and a recorded price still beats it', () => {
  assert.equal(withTypical(catalog, {}), catalog);
  assert.equal(withTypical(catalog, { unicorn: { unit: 'oz', size: 1, price: 1 } }), catalog);
  const mine = withTypical(catalog, { 'greek-yogurt': { unit: 'oz', size: 32, price: 3.98 }, oats: { unit: 'gal', size: 1, price: 2 } });
  assert.notEqual(mine, catalog);
  assert.equal(catalog.itemById.get('greek-yogurt').typical[0].cents, 479, 'the original is untouched');
  const yogurt = mine.itemById.get('greek-yogurt');
  assert.deepEqual([yogurt.typical.length, yogurt.typical[0].cents, yogurt.typical[0].src, yogurt.typicalChanged], [1, 398, 'yours', true]);
  assert.equal(mine.itemForFood.get('greek_yogurt').item, yogurt);
  assert.equal(mine.itemById.get('oats').typical[0].cents, 448, 'an override that makes no sense is ignored');
  assert.ok(mine.sources.yours);

  const input = { catalog: mine, storeId: 'walmart', start: WED, days: 7, kcalFor: () => 1800, swaps: {}, logged: {}, prefs: {}, offers: [], lots: [] };
  const line = (list) => list.lines.find((l) => l.id === 'greek-yogurt');
  assert.equal(line(groceryList(input)).cents, 398);
  assert.equal(line(groceryList(input)).offer.src, 'yours');
  const recorded = [{ id: 'p', item: 'greek-yogurt', store: 'walmart', brand: '', unit: 'oz', size: 32, price: 4.5 }];
  assert.equal(line(groceryList({ ...input, offers: recorded })).cents, 450);
});

test('hidden stores leave the picker, but never all of them', () => {
  const custom = [{ id: 'my-corner', name: 'Corner Market', brand: '' }];
  assert.equal(shownStores(catalog, custom, []).length, catalog.stores.length + 1);
  const hidden = ['safeway', 'costco', 'sprouts', 'winco'];
  assert.deepEqual(shownStores(catalog, [], hidden).map((s) => s.id), ['walmart', 'target', 'trader-joes', 'whole-foods', 'raleys', 'bel-air']);
  assert.equal(findStore(catalog, [], 'costco', hidden).id, 'walmart', 'a hidden store falls back to the first one shown');
  assert.equal(findStore(catalog, [], 'raleys', hidden).id, 'raleys');
  const everything = [...catalog.stores.map((s) => s.id), 'my-corner'];
  assert.equal(shownStores(catalog, custom, everything).length, catalog.stores.length + 1, 'hiding them all shows them all');
  const list = groceryList({ catalog, customStores: [], hiddenStores: hidden, storeId: 'costco', start: WED, days: 3, kcalFor: () => 1800 });
  assert.equal(list.store.id, 'walmart');
});

test('the grocery list follows changed meals, and meals entered as numbers buy nothing', () => {
  const input = { catalog, storeId: 'walmart', start: WED, days: 1, kcalFor: () => 1800, proteinFor: () => 150, swaps: {}, logged: {}, prefs: {}, offers: [], lots: [] };
  const grams = (list, id) => list.lines.find((l) => l.id === id)?.grams || 0;
  const usual = groceryList(input);
  withMeals({ edits: { 'b-yogurt': { items: [['greek_yogurt', 490, ''], ['blueberries', 100, '']] } } }, () => {
    assert.equal(grams(groceryList(input), 'greek-yogurt'), 490);
    assert.equal(grams(groceryList(input), 'oats') < grams(usual, 'oats'), true);
  });
  const bowl = { id: 'my-chipotle-bowl', slot: 'lunch', name: 'Chipotle chicken bowl', facts: { kcal: 780, protein: 52 } };
  withMeals({ added: [bowl], menu: { 2: { lunch: 'my-chipotle-bowl' } } }, () => {
    const list = groceryList(input);
    assert.deepEqual(list.numbersOnly, ['Chipotle chicken bowl']);
    assert.equal(grams(list, 'ground-turkey'), 0, 'the chili is no longer bought');
    // The budget never suggests a meal with nothing to buy, however cheap that looks.
    const week = { ...input, days: 7 };
    const fit = fitBudget({ ...week, budget: 20 });
    assert.ok(fit.moves.length > 0);
    for (const move of fit.moves) assert.ok(!mealById(move.toId).numbersOnly);
  });
  assert.deepEqual(groceryList(input).numbersOnly, []);

  // A modest meal with no ingredients would look free, and so be the best saving everywhere.
  const salad = { id: 'my-deli-salad', slot: 'lunch', name: 'Deli salad', facts: { kcal: 500, protein: 45, carbs: 30, fat: 20 } };
  const wrap = { id: 'my-deli-wrap', slot: 'dinner', name: 'Deli wrap', facts: { kcal: 600, protein: 45, carbs: 50, fat: 20 } };
  withMeals({ added: [salad, wrap] }, () => {
    const fit = fitBudget({ ...input, days: 7, budget: 30 });
    assert.ok(fit.moves.some((move) => move.kind === 'meal'), 'there are meal suggestions');
    assert.ok(fit.moves.every((move) => !['my-deli-salad', 'my-deli-wrap'].includes(move.toId)), JSON.stringify(fit.moves));
  });
});

// ------------------------------------------------------------ GitHub

test('the repository is worked out from the site address', () => {
  assert.deepEqual(guessRepo('https://mbruno429.github.io/fuel/#/settings'), { owner: 'mbruno429', repo: 'fuel', path: 'meal-reminders.ics' });
  assert.deepEqual(guessRepo('https://mbruno429.github.io/fuel/index.html'), { owner: 'mbruno429', repo: 'fuel', path: 'meal-reminders.ics' });
  assert.deepEqual(guessRepo('https://MBruno429.github.io/'), { owner: 'mbruno429', repo: 'mbruno429.github.io', path: 'meal-reminders.ics' });
  assert.deepEqual(guessRepo('https://mbruno429.github.io/tools/fuel/'), { owner: 'mbruno429', repo: 'tools', path: 'fuel/meal-reminders.ics' });
  assert.deepEqual(guessRepo('http://127.0.0.1:8765/fuel/'), { owner: '', repo: '', path: 'meal-reminders.ics' });
  assert.deepEqual(calendarUrls('https://mbruno429.github.io/fuel/#/settings/reminders'), {
    https: 'https://mbruno429.github.io/fuel/meal-reminders.ics',
    webcal: 'webcal://mbruno429.github.io/fuel/meal-reminders.ics',
  });
  const link = new URL(NEW_KEY_URL);
  assert.equal(link.origin + link.pathname, 'https://github.com/settings/personal-access-tokens/new');
  assert.equal(link.searchParams.get('contents'), 'write');
  assert.equal(link.searchParams.get('expires_in'), '90');
  assert.ok(link.searchParams.get('name').length <= 40);
});

test('keys and repository names are checked before use', () => {
  assert.ok(looksLikeKey('github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'));
  assert.ok(looksLikeKey('  ghp_EXAMPLEclassicKeyForTests  '));
  assert.ok(!looksLikeKey('github pat with spaces in it here'));
  assert.ok(!looksLikeKey('short'));
  assert.ok(isClassicKey('ghp_EXAMPLEclassicKeyForTests'));
  assert.ok(!isClassicKey('github_pat_11ABCDEFG0123456789'));
  assert.ok(isRepoName('fuel') && isRepoName('mbruno429.github.io') && isRepoName('my_repo-2'));
  assert.ok(!isRepoName('') && !isRepoName('a/b') && !isRepoName('..') && !isRepoName('has space'));
});

test('text survives the trip through base64, accents and fractions included', () => {
  const text = 'SUMMARY:Breakfast: ½ cup oats, ⅔ cup berries, café\r\nEND\r\n';
  assert.equal(fromBase64(toBase64(text)), text);
  assert.equal(toBase64('Fuel'), 'RnVlbA==');
  assert.equal(fromBase64('RnVl\nbA=='), 'Fuel', 'GitHub wraps its base64 in lines');
  const big = 'x'.repeat(100000) + '½';
  assert.equal(fromBase64(toBase64(big)), big);
  assert.ok(sameCalendar('A\r\nDTSTAMP:20261127T000000Z\r\nB\r\n', 'A\nDTSTAMP:20991231T235959Z\nB\n'));
  assert.ok(!sameCalendar('A\r\nB\r\n', 'A\r\nC\r\n'));
});

const TOKEN = 'github_pat_SECRET0123456789abcdefghij';

/** A stand-in for api.github.com that records every request. */
function fakeGitHub({ file = null, branch = 'main', fail = {}, conflicts = 0 } = {}) {
  const calls = [];
  let stored = file;
  let sha = file ? 'sha-1' : null;
  let conflictsLeft = conflicts;
  const reply = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: new Map(Object.entries(headers)), json: async () => body });
  const fetchImpl = async (url, options) => {
    const { pathname, search } = new URL(url);
    calls.push({ method: options.method, path: pathname + search, headers: options.headers, body: options.body ? JSON.parse(options.body) : null, options });
    const key = `${options.method} ${pathname}`;
    if (fail[key]) return reply(...fail[key]);
    if (pathname === '/repos/mbruno429/fuel' && options.method === 'GET') return reply(200, { full_name: 'mbruno429/fuel', default_branch: branch });
    if (pathname === '/repos/mbruno429/fuel/contents/meal-reminders.ics') {
      if (options.method === 'GET') {
        if (!stored) return reply(404, { message: 'Not Found' });
        return reply(200, { sha, content: toBase64(stored).replace(/(.{60})/g, '$1\n') });
      }
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body);
        if (conflictsLeft > 0) {
          conflictsLeft -= 1;
          sha = `${sha}-moved`;
          return reply(409, { message: 'is at a different sha' });
        }
        if ((body.sha || null) !== sha) return reply(422, { message: 'sha does not match' });
        stored = fromBase64(body.content);
        sha = `sha-${calls.length}`;
        return reply(200, { commit: { sha: `commit-${calls.length}` } });
      }
    }
    return reply(404, { message: 'Not Found' });
  };
  return { fetchImpl, calls, get stored() { return stored; } };
}

const publishArgs = (gh, content = 'BEGIN:VCALENDAR\r\nDTSTAMP:1\r\nEND:VCALENDAR\r\n') => ({
  token: TOKEN, owner: 'mbruno429', repo: 'fuel', path: 'meal-reminders.ics', content, message: 'Update meal reminders from Fuel', same: sameCalendar, fetchImpl: gh.fetchImpl,
});

test('publishing creates the file, or replaces it on the branch the site comes from', async () => {
  const fresh = fakeGitHub({ branch: 'main' });
  const created = await publishFile(publishArgs(fresh));
  assert.deepEqual(created, { unchanged: false, branch: 'main', commit: 'commit-3' });
  assert.deepEqual(fresh.calls.map((c) => `${c.method} ${c.path}`), [
    'GET /repos/mbruno429/fuel',
    'GET /repos/mbruno429/fuel/contents/meal-reminders.ics?ref=main',
    'PUT /repos/mbruno429/fuel/contents/meal-reminders.ics',
  ]);
  const put = fresh.calls[2];
  assert.equal(put.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(put.headers.Accept, 'application/vnd.github+json');
  assert.equal(put.options.credentials, 'omit');
  assert.equal(put.options.cache, 'no-store');
  assert.deepEqual(Object.keys(put.body).sort(), ['branch', 'content', 'message']);
  assert.equal(put.body.branch, 'main');
  assert.equal(fresh.stored, 'BEGIN:VCALENDAR\r\nDTSTAMP:1\r\nEND:VCALENDAR\r\n');

  const existing = fakeGitHub({ file: 'OLD\r\n', branch: 'gh-pages' });
  await publishFile(publishArgs(existing));
  assert.equal(existing.calls[1].path, '/repos/mbruno429/fuel/contents/meal-reminders.ics?ref=gh-pages');
  assert.equal(existing.calls[2].body.sha, 'sha-1');
  assert.equal(existing.calls[2].body.branch, 'gh-pages');
});

test('publishing the same reminders again writes nothing', async () => {
  const gh = fakeGitHub({ file: 'BEGIN:VCALENDAR\r\nDTSTAMP:20260101T000000Z\r\nEND:VCALENDAR\r\n' });
  const result = await publishFile(publishArgs(gh));
  assert.deepEqual(result, { unchanged: true, branch: 'main', commit: null });
  assert.ok(gh.calls.every((c) => c.method === 'GET'));
});

test('if the file moves on GitHub mid-update, it reads it again and tries once more', async () => {
  const once = fakeGitHub({ file: 'OLD\r\n', conflicts: 1 });
  const result = await publishFile(publishArgs(once));
  assert.equal(result.unchanged, false);
  assert.deepEqual(once.calls.map((c) => c.method), ['GET', 'GET', 'PUT', 'GET', 'PUT']);
  assert.equal(once.calls[4].body.sha, 'sha-1-moved');

  const twice = fakeGitHub({ file: 'OLD\r\n', conflicts: 2 });
  await assert.rejects(publishFile(publishArgs(twice)), (error) => error instanceof PublishError && error.kind === 'refused');
});

test('GitHub errors become plain messages, and the key never appears in them', async () => {
  const cases = [
    [{ 'GET /repos/mbruno429/fuel': [401, { message: 'Bad credentials' }] }, 'auth', /did not accept the key/],
    [{ 'GET /repos/mbruno429/fuel': [404, { message: 'Not Found' }] }, 'missing', /no repository mbruno429\/fuel/],
    [{ 'PUT /repos/mbruno429/fuel/contents/meal-reminders.ics': [403, { message: 'Resource not accessible by personal access token' }] }, 'permission', /Contents set to Read and write/],
    [{ 'GET /repos/mbruno429/fuel': [403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }] }, 'limited', /limiting requests/],
    [{ 'GET /repos/mbruno429/fuel/contents/meal-reminders.ics': [500, { message: 'Server Error' }] }, 'other', /\(500\): Server Error/],
  ];
  for (const [fail, kind, pattern] of cases) {
    const gh = fakeGitHub({ fail });
    await assert.rejects(publishFile(publishArgs(gh)), (error) => {
      assert.ok(error instanceof PublishError, String(error));
      assert.equal(error.kind, kind);
      assert.match(error.message, pattern);
      assert.ok(!error.message.includes(TOKEN) && !error.message.includes('SECRET'));
      return true;
    });
  }
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(publishFile({ ...publishArgs(fakeGitHub()), fetchImpl: offline }), (error) => {
    assert.equal(error.kind, 'network');
    assert.match(error.message, /reach GitHub/);
    assert.ok(!error.message.includes('SECRET'));
    return true;
  });
  await assert.rejects(checkKey({ token: TOKEN, owner: 'mbruno429', repo: 'fuel', fetchImpl: offline }), (error) => !error.message.includes('SECRET'));
});

test('checking a key reports the repository and its branch', async () => {
  const gh = fakeGitHub({ branch: 'main' });
  assert.deepEqual(await checkKey({ token: TOKEN, owner: 'mbruno429', repo: 'fuel', fetchImpl: gh.fetchImpl }), { fullName: 'mbruno429/fuel', branch: 'main' });
  await assert.rejects(checkKey({ token: TOKEN, owner: 'mbruno429', repo: 'fuels', fetchImpl: gh.fetchImpl }), (error) => error.kind === 'missing');
  assert.equal(gh.calls.length, 2);
  assert.ok(gh.calls.every((c) => c.method === 'GET'), 'checking never writes');
});

// ------------------------------------------------------------ saved changes

test('saved changes are checked on the way in, and the GitHub key is kept out of backups', async () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  const { normalizeState, store, keyStore } = await import(`../js/store.js?fresh=${Date.now()}`);

  const junk = normalizeState({
    custom: {
      times: { breakfast: '06:30', lunch: '25:00', dinner: 7 },
      meals: {
        edits: { 'b-oats': { items: [['oats', 50, ''], ['nope', 5, '']], method: 'Soak.' }, 'my-thing': { name: 'Not built in' }, 'b-shake': { items: [['nope', 1, '']] } },
        added: [
          { id: 'my-bowl', slot: 'lunch', name: 'Bowl', facts: { kcal: 600, protein: 40 } },
          { id: 'my-bowl', slot: 'lunch', name: 'Bowl again', facts: { kcal: 600 } },
          { id: 'Bad Id', slot: 'lunch', name: 'Bad', facts: { kcal: 600 } },
        ],
        auto: { 's-apple': true, 'my-bowl': 'yes', 'my-ghost': false },
      },
      menu: { 2: { lunch: 'my-bowl', dinner: 'my-ghost' }, 14: { lunch: 'l-bowl' }, x: { lunch: 'l-bowl' } },
    },
    reminders: { published: { at: '2026-11-27T08:00:00.000Z', signature: 'abc-2027-03-25', kcal: '1800', until: '2027-03-25', times: { lunch: '12:30' } } },
  });
  assert.deepEqual(junk.custom.times, { ...CONFIG.mealTimes, breakfast: '06:30' });
  assert.deepEqual(junk.custom.meals.edits, { 'b-oats': { items: [['oats', 50, '']], method: 'Soak.' } });
  assert.deepEqual(junk.custom.meals.added.map((m) => m.id), ['my-bowl']);
  assert.deepEqual(junk.custom.meals.auto, { 's-apple': true });
  assert.deepEqual(junk.custom.menu, { 2: { lunch: 'my-bowl' } });
  assert.equal(junk.reminders.published.kcal, 1800);
  assert.equal(junk.reminders.published.times.lunch, '12:30');
  assert.equal(junk.reminders.published.times.dinner, CONFIG.mealTimes.dinner);
  assert.equal(normalizeState({ reminders: { published: { at: 'x' } } }).reminders.published, null);

  // Through the store: add a meal, use it in the menu, delete it, and it is gone from both.
  const id = store.addMeal({ slot: 'dinner', name: 'Steak salad!', items: [['sirloin_raw', 170, ''], ['salad_greens', 100, '']] });
  assert.equal(id, 'my-steak-salad');
  assert.equal(store.addMeal({ slot: 'dinner', name: 'Steak salad', facts: { kcal: 500 } }), 'my-steak-salad-2');
  store.setMenu(4, 'dinner', id);
  store.setSwap('2026-12-01', 'dinner', id);
  assert.deepEqual(store.state.custom.menu, { 4: { dinner: id } });
  store.deleteMeal(id);
  assert.deepEqual(store.state.custom.menu, {});
  assert.deepEqual(store.state.swaps, {});
  assert.deepEqual(store.state.custom.meals.added.map((m) => m.id), ['my-steak-salad-2']);
  assert.equal(store.saveMeal('b-yogurt', { items: [['greek_yogurt', 300, '']] }), 'b-yogurt');
  assert.equal(store.saveMeal('b-yogurt', { items: [['nope', 300, '']] }), null, 'a change with nothing usable is refused');
  store.resetMeal('b-yogurt');
  assert.deepEqual(store.state.custom.meals.edits, {});

  // The key lives apart from the data, so a backup never carries it.
  assert.ok(keyStore.set({ token: TOKEN, owner: 'mbruno429', repo: 'fuel', path: 'meal-reminders.ics' }));
  assert.equal(keyStore.get().token, TOKEN);
  assert.ok(!store.exportJSON().includes('SECRET'));
  assert.ok(![...memory.entries()].some(([key, value]) => key === 'fuel:v1' && value.includes('SECRET')));
  store.reset();
  assert.equal(keyStore.get(), null, 'erasing everything removes the key too');
});
