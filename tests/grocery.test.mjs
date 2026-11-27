// Run with:  npm test   (or: node --test)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { nutWordIn } from '../js/allergens.js';
import { addDays, planForDate } from '../js/core.js';
import { FOODS } from '../js/foods.js';
import {
  AISLES,
  PER_LB,
  STORE_BRAND,
  allStores,
  amountText,
  buildList,
  fitBudget,
  foodNeeds,
  formatMoney,
  groceryList,
  itemNeeds,
  listAsText,
  makeOffer,
  periodMeals,
  poundsText,
  readCatalog,
  seasoningsFor,
  sizeInGrams,
  stockAt,
  unitsFor,
} from '../js/grocery.js';
import { MEALS } from '../js/meals.js';
import { normalizeState } from '../js/store.js';

const RAW = JSON.parse(readFileSync(new URL('../data/groceries.json', import.meta.url), 'utf8'));
const { catalog, problems } = readCatalog(RAW);

const DAY_ONE = '2026-11-25'; // a Wednesday: yogurt bowl, turkey chili, a snack, baked salmon
const base = {
  catalog,
  storeId: 'walmart',
  start: DAY_ONE,
  days: 7,
  kcalFor: () => 1800,
  proteinFor: () => 150,
  swaps: {},
  logged: {},
  servings: 1,
  prefs: {},
  offers: [],
  lots: [],
};
const item = (id) => catalog.itemById.get(id);
const line = (list, id) => list.lines.find((entry) => entry.id === id);
const near = (a, b, tolerance = 0.01) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

/** Everything about a list that a shopper would see, as plain data. */
function seen(list) {
  return {
    store: list.store.id,
    total: list.totalCents,
    used: list.usedCents,
    lines: list.lines.map((l) => [l.id, l.quantity, l.cents, l.brand, l.basis, l.checked, l.partly, l.from]),
    home: list.atHome.map((h) => [h.id, Math.round(h.left)]),
    seasonings: list.seasonings,
  };
}

/** A list bought in full on its first day: one purchase record per line. */
function boughtAll(list, { home = false, skip = [] } = {}) {
  return list.lines.map((l, i) => ({
    id: `lot-${i}`, item: l.id, date: list.start, grams: l.covers, until: l.item.keeps ? null : list.end, home, skip,
  }));
}

// ------------------------------------------------------------ the price list

test('the price list reads cleanly and covers every ingredient in the plan', () => {
  assert.deepEqual(problems, []);
  assert.ok(catalog.stores.length >= 6);
  assert.equal(new Set(catalog.stores.map((s) => s.id)).size, catalog.stores.length);

  // Every ingredient a meal uses is bought as exactly one item.
  const used = new Set(MEALS.flatMap((meal) => meal.items.map(([food]) => food)));
  for (const food of used) assert.ok(catalog.itemForFood.has(food), `nothing on the list buys "${food}"`);
  for (const food of catalog.itemForFood.keys()) assert.ok(FOODS[food], `the price list names an unknown food "${food}"`);

  for (const entry of catalog.items) {
    assert.ok(AISLES.includes(entry.aisle));
    assert.ok(entry.typical.length >= 1, `${entry.id} has a typical price`);
    for (const offer of entry.typical) {
      assert.ok(offer.cents > 0 && offer.grams > 0, `${entry.id} price`);
      assert.ok(catalog.sources[offer.src], `${entry.id} names a known source`);
    }
    for (const factor of Object.values(entry.foods)) assert.ok(factor > 0.2 && factor < 2.5, `${entry.id} conversion looks wrong`);
  }
  // Pantry and frozen food keeps; fresh food does not, apart from the few marked.
  assert.equal(item('olive-oil').keeps, true);
  assert.equal(item('edamame').keeps, true);
  assert.equal(item('eggs').keeps, true);
  assert.equal(item('chicken-breast').keeps, false);
  assert.equal(item('spinach').keeps, false);
});

test('no peanuts or tree nuts anywhere in the price list', () => {
  const nutWords = /\b(nuts?|peanuts?|almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|macadamia|brazil|pine|praline|marzipan|nougat|pesto|satay|nutella|granola|trail)\b/i;
  const texts = [
    ...catalog.stores.flatMap((s) => [s.name, s.brand]),
    ...catalog.items.flatMap((entry) => [entry.id.replace(/-/g, ' '), entry.name, entry.as, ...entry.typical.map((offer) => offer.label)]),
  ];
  for (const text of texts) {
    assert.ok(!nutWords.test(text), `"${text}"`);
    assert.equal(nutWordIn(text), null, `"${text}"`);
  }
  // The shared guard agrees with the one written out here.
  assert.equal(nutWordIn('Almond Breeze'), 'almond');
  assert.equal(nutWordIn('honey roasted PEANUTS'), 'peanuts');
  assert.equal(nutWordIn('pine_nut'), 'pine');
  assert.equal(nutWordIn('nonstick pan, nutmeg and pineapple'), null);
  assert.equal(nutWordIn(undefined), null);
});

test('a broken price list is refused or cleaned, never trusted', () => {
  assert.equal(readCatalog(null).catalog, null);
  assert.equal(readCatalog({ stores: [], items: [] }).catalog, null);
  assert.equal(readCatalog({ stores: [{ id: 'a', name: 'A' }], items: [] }).catalog, null);

  const store = { id: 'a', name: 'A' };
  const good = { id: 'oats', name: 'Oats', aisle: 'Pantry', foods: { oats: 1 }, typical: [{ size: 42, unit: 'oz', price: 4.48 }] };
  const read = readCatalog({
    stores: [store, store, { name: 'No id' }],
    items: [
      good,
      { ...good }, // listed twice
      { ...good, id: 'oats-2' }, // claims a food that is taken
      { ...good, id: 'x', foods: { whey: 1 }, aisle: 'Garden' }, // unknown aisle
      { ...good, id: 'y', foods: { whey: 1 }, typical: [{ size: 1, unit: 'gal', price: 5 }] }, // a gallon of something with no density
      { ...good, id: 'z', foods: { whey: -1 } },
      'nonsense',
    ],
  });
  assert.deepEqual(read.catalog.stores.map((s) => s.id), ['a']);
  assert.deepEqual(read.catalog.items.map((entry) => entry.id), ['oats']);
  assert.ok(read.problems.length >= 6, read.problems.join(' | '));
});

test('package sizes convert to grams', () => {
  near(sizeInGrams(item('greek-yogurt'), 32, 'oz'), 907.18);
  near(sizeInGrams(item('whey'), 2, 'lb'), 907.18);
  near(sizeInGrams(item('milk'), 0.5, 'gal'), 1949.49); // half a gallon of milk at 1.03 g per ml
  near(sizeInGrams(item('olive-oil'), 16.9, 'fl oz'), 459.81);
  assert.equal(sizeInGrams(item('eggs'), 12, 'count'), 600);
  assert.equal(sizeInGrams(item('oats'), 1, 'gal'), null); // oats have no density
  assert.equal(sizeInGrams(item('oats'), 3, 'count'), null); // or a piece size
  assert.equal(sizeInGrams(item('oats'), 0, 'oz'), null);
  assert.equal(sizeInGrams(item('oats'), 5, 'cups'), null);

  assert.deepEqual(unitsFor(item('oats')), [PER_LB, 'oz', 'lb', 'g', 'kg']);
  assert.ok(unitsFor(item('milk')).includes('gal'));
  assert.ok(unitsFor(item('eggs')).includes('count'));

  assert.equal(makeOffer(item('oats'), { unit: 'oz', size: 42, price: 4.48 }).label, '42 oz');
  assert.equal(makeOffer(item('oats'), { unit: 'oz', size: 42, price: 4.48, form: 'canister' }).label, '42 oz canister');
  assert.equal(makeOffer(item('eggs'), { unit: 'count', size: 18, price: 4 }).label, 'pack of 18');
  assert.equal(makeOffer(item('salmon'), { unit: PER_LB, price: 11.99 }).kind, 'weight');
  assert.equal(makeOffer(item('oats'), { unit: 'oz', size: 42, price: 0 }), null);
  assert.equal(makeOffer(item('oats'), { unit: 'oz', size: 42, price: 'free' }), null);
});

test('money, pounds and amounts read the way a shopper says them', () => {
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(5), '$0.05');
  assert.equal(formatMoney(1240), '$12.40');
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(-250), '-$2.50');
  assert.equal(poundsText(0.25), '¼ lb');
  assert.equal(poundsText(1.5), '1½ lb');
  assert.equal(poundsText(2), '2 lb');
  assert.equal(poundsText(2.75), '2¾ lb');
  assert.equal(amountText(item('bananas'), 0, 118 * 6), '6 bananas');
  assert.equal(amountText(item('bananas'), 0, 118), '1 banana');
  assert.equal(amountText(item('olive-oil'), 61, 61), '2 fl oz');
  assert.equal(amountText(item('greek-yogurt'), 855, 855), '1.9 lb');
  assert.equal(amountText(item('feta'), 30, 30), '1 oz');
});

// ------------------------------------------------------------ needs

test('needs add up the planned meals and convert to what you buy', () => {
  const plan = planForDate(DAY_ONE, 1800);
  assert.deepEqual(plan.slots.filter((s) => s.meal).map((s) => s.slot), ['breakfast', 'lunch', 'snack', 'dinner']);
  assert.equal(plan.slots.find((s) => s.slot === 'dinner').meal.id, 'd-salmon');
  assert.equal(plan.slots.find((s) => s.slot === 'lunch').meal.id, 'l-chili');

  const meals = periodMeals({ start: DAY_ONE, days: 1, kcalFor: () => 1800 });
  assert.equal(meals.length, 4);
  const { byItem, unmapped } = itemNeeds(catalog, foodNeeds(meals));
  assert.deepEqual(unmapped, []);
  near(byItem.get('salmon').grams, 170); // 6 oz fillet, bought as is
  near(byItem.get('ground-turkey').grams, 142);
  near(byItem.get('black-beans').grams, 115 * 1.67); // drained beans need more can
  near(byItem.get('brown-rice').grams, 100 * 0.34); // cooked rice needs less dry rice
  near(byItem.get('broccoli').grams, 200 * 1.15); // florets from crowns
  assert.equal(byItem.get('brown-rice').planGrams, 100);
  assert.deepEqual(byItem.get('salmon').uses.map((use) => [use.date, use.slot, use.mealId, use.grams]), [[DAY_ONE, 'dinner', 'd-salmon', 170]]);

  // Dinner for four multiplies the dinner, and only the dinner.
  const four = itemNeeds(catalog, foodNeeds(meals, 4)).byItem;
  near(four.get('salmon').grams, 680);
  near(four.get('ground-turkey').grams, 142);

  // A meal already logged needs no shopping.
  const eaten = periodMeals({ start: DAY_ONE, days: 1, kcalFor: () => 1800, logged: { [DAY_ONE]: ['dinner', 'breakfast'] } });
  assert.deepEqual(eaten.map((m) => m.slot), ['lunch', 'snack']);
  assert.equal(itemNeeds(catalog, foodNeeds(eaten)).byItem.has('salmon'), false);

  // A swap changes what is needed.
  const swapped = periodMeals({ start: DAY_ONE, days: 1, kcalFor: () => 1800, swaps: { [DAY_ONE]: { dinner: 'd-cod' } } });
  const afterSwap = itemNeeds(catalog, foodNeeds(swapped)).byItem;
  assert.equal(afterSwap.has('salmon'), false);
  near(afterSwap.get('cod').grams, 200);

  // Cooked and raw chicken are one thing to buy.
  const chicken = itemNeeds(catalog, new Map([['chicken_raw', { grams: 180, uses: [] }], ['chicken_cooked', { grams: 140, uses: [] }]])).byItem;
  near(chicken.get('chicken-breast').grams, 180 + 140 * 1.33);
  assert.deepEqual(itemNeeds(catalog, new Map([['unobtainium', { grams: 5, uses: [] }]])).unmapped, ['unobtainium']);

  assert.deepEqual(seasoningsFor(meals), ['lemon', 'chili powder', 'cumin', 'salt', 'pepper']);
  assert.deepEqual(seasoningsFor([]), []);
});

test('a week of meals makes a sensible list', () => {
  const list = groceryList(base);
  assert.equal(list.start, DAY_ONE);
  assert.equal(list.end, '2026-12-01');
  assert.deepEqual(list.unmapped, []);
  assert.ok(list.lines.length > 40 && list.lines.length <= catalog.items.length);
  assert.equal(list.atHome.length, 0);
  assert.equal(list.totalCents, list.lines.reduce((sum, l) => sum + l.cents, 0));
  assert.equal(list.totalCents, list.groups.reduce((sum, g) => sum + g.cents, 0));
  assert.ok(list.usedCents < list.totalCents, 'whole packages hold more than a week uses');
  assert.equal(list.recordedCount, 0);
  assert.equal(list.checkedCount, 0);
  for (const l of list.lines) {
    assert.ok(l.covers >= l.grams * 0.95 - 1e-6, `${l.id} is covered`);
    assert.ok(l.cents > 0 && Number.isInteger(l.cents), `${l.id} has a whole number of cents`);
    assert.ok(l.usedCents <= l.cents);
    assert.equal(l.estimate, true);
    assert.equal(l.basis, 'typical');
  }
  // Aisles in store order, names in alphabetical order within an aisle.
  const aisles = list.groups.map((g) => g.aisle);
  assert.deepEqual(aisles, AISLES.filter((aisle) => aisles.includes(aisle)));
  for (const group of list.groups) {
    const names = group.lines.map((l) => l.name.toLowerCase());
    assert.deepEqual(names, [...names].sort());
  }
  // No brand is named until the shopper names one: the store's own product stays unnamed.
  assert.ok(list.lines.every((l) => l.brand === '' && !l.preferred));
  assert.equal(seen(groceryList({ ...base, storeId: 'whole-foods' })).total, seen(list).total); // typical prices are the same everywhere
  assert.equal(groceryList({ ...base, storeId: 'nowhere' }).store.id, 'walmart'); // an unknown store falls back to the first

  // Longer lists need more, never less.
  assert.ok(groceryList({ ...base, days: 14 }).totalCents > list.totalCents);
  assert.ok(groceryList({ ...base, days: 3 }).totalCents < list.totalCents);
});

// ------------------------------------------------------------ quantities and prices

test('packages round up, with a little tolerance; loose food goes by the quarter pound', () => {
  const needs = (id, grams, planGrams = grams) => new Map([[id, { grams, planGrams, uses: [] }]]);
  const one = (id, grams, planGrams) => buildList({ catalog, storeId: 'walmart', needs: needs(id, grams, planGrams) }).lines[0];

  // A 16 oz pack is 453.6 g. Being 5% short is fine; more than that takes a second pack.
  assert.equal(one('ground-turkey', 400).qty, 1);
  assert.equal(one('ground-turkey', 470).qty, 1);
  assert.equal(one('ground-turkey', 480).qty, 2);
  assert.equal(one('ground-turkey', 480).cents, 1058);
  assert.equal(one('ground-turkey', 480).quantity, '2 × 16 oz pack');
  assert.equal(one('ground-turkey', 400).quantity, '16 oz pack');

  // Salmon at $11.99 a pound: 170 g is 0.37 lb, bought as half a pound.
  const salmon = one('salmon', 170);
  assert.equal(salmon.qty, 0.5);
  assert.equal(salmon.cents, 600);
  assert.equal(salmon.quantity, '½ lb');
  assert.equal(one('salmon', 10).qty, 0.25); // never less than a quarter pound
  assert.equal(one('salmon', 454).qty, 1);
  assert.equal(one('salmon', 520).qty, 1.25);

  // Things counted in pieces say how many.
  assert.equal(one('bananas', 118 * 6 * 1.56, 118 * 6).quantity, '6 bananas, about 2½ lb');
  assert.equal(one('avocados', 145, 145).quantity, '1 avocado');
  assert.equal(one('bell-peppers', 220, 220).quantity, '2 peppers');
  assert.equal(one('eggs', 350, 350).quantity, 'carton of 12');

  // The cheapest way to cover the need wins, whatever the package size.
  assert.equal(one('spinach', 90).offer.label, '5 oz bag');
  assert.equal(one('spinach', 250).offer.label, '10 oz bag');
  assert.equal(one('spinach', 250).cents, 398);
  assert.equal(one('milk', 366).offer.label, 'half gallon');
  assert.equal(one('milk', 2400).offer.label, 'gallon');

  // What the meals use of it is costed in proportion.
  assert.equal(one('ground-turkey', 226.8).usedCents, Math.round(529 / 2));
});

test('a price you record beats the typical price, at that store only', () => {
  const offers = [{ id: 'p1', item: 'greek-yogurt', store: 'walmart', brand: '', unit: 'oz', size: 32, price: 3.98, date: DAY_ONE }];
  const atWalmart = line(groceryList({ ...base, offers }), 'greek-yogurt');
  assert.equal(atWalmart.cents, 398);
  assert.equal(atWalmart.basis, 'recorded');
  assert.equal(atWalmart.estimate, false);
  assert.equal(atWalmart.brand, '');

  const atTarget = line(groceryList({ ...base, offers, storeId: 'target' }), 'greek-yogurt');
  assert.equal(atTarget.cents, 479);
  assert.equal(atTarget.basis, 'typical');

  // Recording the store's brand by name is the same as leaving the brand empty.
  const named = [{ ...offers[0], brand: 'great  VALUE', price: 5.25 }];
  assert.equal(line(groceryList({ ...base, offers: named }), 'greek-yogurt').cents, 525);
  assert.equal(line(groceryList({ ...base, offers: named }), 'greek-yogurt').basis, 'recorded');
  assert.equal(line(groceryList({ ...base, offers: named }), 'greek-yogurt').brand, 'great VALUE'); // shown as typed

  assert.equal(groceryList({ ...base, offers }).recordedCount, 1);

  // Prices that make no sense, or for things not on the price list, are ignored.
  const junk = [
    { item: 'greek-yogurt', store: 'walmart', unit: 'gal', size: 1, price: 2 },
    { item: 'greek-yogurt', store: 'walmart', unit: 'oz', size: 32, price: -1 },
    { item: 'unicorn', store: 'walmart', unit: 'oz', size: 32, price: 1 },
    null,
  ];
  assert.deepEqual(seen(groceryList({ ...base, offers: junk })), seen(groceryList(base)));
});

test('brand choices', () => {
  const fage = { id: 'p1', item: 'greek-yogurt', store: 'walmart', brand: 'Fage', unit: 'oz', size: 32, price: 6.99, date: DAY_ONE };
  const yogurt = (extra) => line(groceryList({ ...base, offers: [fage], ...extra }), 'greek-yogurt');

  // No choice: the lowest cost wins, and the dearer brand loses.
  assert.equal(yogurt().cents, 479);
  assert.equal(yogurt().preferred, false);
  assert.equal(yogurt().cheaper, null);

  // Choosing the brand buys it, and notes what the cheapest would save.
  const chosen = yogurt({ prefs: { 'greek-yogurt': { brand: 'fage' } } });
  assert.equal(chosen.cents, 699);
  assert.equal(chosen.brand, 'Fage');
  assert.equal(chosen.basis, 'recorded');
  assert.equal(chosen.preferred, true);
  assert.deepEqual([chosen.cheaper.saving, chosen.cheaper.brand, chosen.cheaper.cents], [220, '', 479]);

  // At a store with no price for the brand, its price elsewhere stands in.
  const elsewhere = yogurt({ prefs: { 'greek-yogurt': { brand: 'Fage' } }, storeId: 'target' });
  assert.equal(elsewhere.cents, 699);
  assert.equal(elsewhere.basis, 'elsewhere');
  assert.equal(elsewhere.estimate, true);

  // A brand with no price anywhere is costed at the typical price, under its own name.
  const unpriced = yogurt({ prefs: { 'greek-yogurt': { brand: 'Chobani' } } });
  assert.equal(unpriced.cents, 479);
  assert.equal(unpriced.brand, 'Chobani');
  assert.equal(unpriced.basis, 'guess');
  assert.equal(unpriced.cheaper, null);

  // "Store brand" follows the store. Naming the store's brand means the same thing.
  const own = yogurt({ prefs: { 'greek-yogurt': { brand: STORE_BRAND } } });
  assert.deepEqual([own.cents, own.basis, own.preferred, own.brand], [479, 'typical', true, '']);
  assert.equal(yogurt({ prefs: { 'greek-yogurt': { brand: STORE_BRAND } }, storeId: 'whole-foods' }).basis, 'typical');
  assert.equal(yogurt({ prefs: { 'greek-yogurt': { brand: 'Great Value' } } }).basis, 'typical');
  // At Target, "Great Value" is just a brand with no price there.
  assert.equal(yogurt({ prefs: { 'greek-yogurt': { brand: 'Great Value' } }, storeId: 'target' }).basis, 'guess');
  // With the store's own product recorded dearer than Fage, "store brand" still buys the store's own.
  const dearOwn = { id: 'p2', item: 'greek-yogurt', store: 'walmart', brand: '', unit: 'oz', size: 32, price: 7.5 };
  const ownDear = line(groceryList({ ...base, offers: [fage, dearOwn], prefs: { 'greek-yogurt': { brand: STORE_BRAND } } }), 'greek-yogurt');
  assert.deepEqual([ownDear.cents, ownDear.basis, ownDear.cheaper.brand, ownDear.cheaper.saving], [750, 'recorded', 'Fage', 51]);

  // A name that mentions a nut is flagged, whatever the item.
  const almond = groceryList({ ...base, prefs: { milk: { brand: 'Almond Breeze' } } });
  assert.equal(line(almond, 'milk').nutWord, 'almond');
  assert.equal(line(almond, 'greek-yogurt').nutWord, null);

  // Choices for other items do not leak.
  assert.equal(line(groceryList({ ...base, offers: [fage], prefs: { 'greek-yogurt': { brand: 'Fage' } } }), 'milk').preferred, false);
});

test('the same inputs always give the same list, in any order they arrive', () => {
  const offers = [
    { id: 'a', item: 'greek-yogurt', store: 'walmart', brand: 'Fage', unit: 'oz', size: 32, price: 6.99, date: DAY_ONE },
    { id: 'b', item: 'greek-yogurt', store: 'walmart', brand: 'Chobani', unit: 'oz', size: 32, price: 6.99, date: DAY_ONE },
    { id: 'c', item: 'greek-yogurt', store: 'target', brand: 'Fage', unit: 'oz', size: 32, price: 7.49, date: DAY_ONE },
    { id: 'd', item: 'chicken-breast', store: 'walmart', brand: '', unit: PER_LB, size: 1, price: 3.97, date: DAY_ONE },
    { id: 'e', item: 'eggs', store: 'walmart', brand: '', unit: 'count', size: 18, price: 4.12, date: DAY_ONE },
    { id: 'f', item: 'eggs', store: 'walmart', brand: '', unit: 'count', size: 12, price: 2.75, date: DAY_ONE },
    { id: 'g', item: 'olive-oil', store: 'walmart', brand: 'Bertolli', unit: 'fl oz', size: 25.5, price: 11.98, date: DAY_ONE },
  ];
  const prefs = { 'greek-yogurt': { brand: 'Fage' }, 'olive-oil': { brand: 'Bertolli', keep: true }, eggs: { brand: STORE_BRAND } };
  const first = groceryList(base);
  const lots = [...boughtAll(first).filter((lot) => ['whey', 'oats', 'eggs', 'salmon'].includes(lot.item)),
    { id: 'h', item: 'honey', date: DAY_ONE, grams: 340, until: null, home: true, skip: [] }];
  const input = { ...base, start: addDays(DAY_ONE, 2), offers, prefs, lots, swaps: { '2026-11-29': { dinner: 'd-tacos' } }, budget: 120 };

  const once = fitBudget(input);
  const again = fitBudget(input);
  assert.deepEqual(seen(again.list), seen(once.list));
  assert.deepEqual(again.moves, once.moves);
  assert.equal(again.afterCents, once.afterCents);

  // Reorder everything that has an order: the result may not move.
  const reversedPrefs = Object.fromEntries(Object.entries(prefs).reverse());
  const shuffled = fitBudget({ ...input, offers: [...offers].reverse(), lots: [...lots].reverse(), prefs: reversedPrefs });
  assert.deepEqual(seen(shuffled.list), seen(once.list));
  assert.deepEqual(shuffled.moves, once.moves);
  const rotated = fitBudget({ ...input, offers: [...offers.slice(3), ...offers.slice(0, 3)], lots: [...lots.slice(2), ...lots.slice(0, 2)] });
  assert.deepEqual(seen(rotated.list), seen(once.list));

  // Two offers tied on cost: the lower unit price, then the name, decides. Never the order.
  const tied = line(groceryList({ ...base, offers: offers.slice(0, 2), prefs: {} }), 'greek-yogurt');
  assert.deepEqual([tied.brand, tied.cents], ['', 479]); // the typical price is cheaper than either
  const noTypical = [
    { id: 'x', item: 'greek-yogurt', store: 'walmart', brand: '', unit: 'oz', size: 32, price: 6.99 },
    ...offers.slice(0, 2),
  ];
  for (const order of [noTypical, [...noTypical].reverse()]) {
    assert.equal(line(groceryList({ ...base, offers: order }), 'greek-yogurt').offer.id, 'x'); // no brand sorts before 'chobani'
  }
});

// ------------------------------------------------------------ what is at home

test('ticked items stay on the list that day and count as stock from the next', () => {
  const first = groceryList(base);
  const lots = boughtAll(first);

  // Same day: nothing leaves the list, everything shows as in the cart.
  const sameDay = groceryList({ ...base, lots });
  assert.deepEqual(seen(sameDay).lines.map((l) => l.slice(0, 5)), seen(first).lines.map((l) => l.slice(0, 5)));
  assert.equal(sameDay.totalCents, first.totalCents);
  assert.equal(sameDay.checkedCount, first.lines.length);
  assert.ok(sameDay.lines.every((l) => l.checked));

  // Next day the window moves on a day: only what the new last day needs is missing.
  const nextDay = groceryList({ ...base, start: addDays(DAY_ONE, 1), lots });
  assert.ok(nextDay.lines.length < 15, `${nextDay.lines.length} items the day after a full shop`);
  assert.ok(nextDay.totalCents < first.totalCents / 4);
  assert.ok(nextDay.atHome.length > 40);
  assert.equal(nextDay.checkedCount, 0);
  for (const l of nextDay.lines) assert.equal(l.from, '2026-12-02', `${l.id} is only short on the new last day`);

  // A week on, fresh food has to be bought again; most food that keeps is still there.
  const nextWeek = groceryList({ ...base, start: addDays(DAY_ONE, 7), lots });
  assert.ok(line(nextWeek, 'chicken-breast'));
  assert.ok(line(nextWeek, 'spinach'));
  for (const id of ['whey', 'oats', 'olive-oil', 'honey', 'brown-rice']) {
    assert.ok(nextWeek.atHome.some((h) => h.id === id), `${id} is still at home`);
    assert.equal(line(nextWeek, id), undefined);
  }
  assert.ok(nextWeek.totalCents < first.totalCents * 0.75, 'the second week costs clearly less than the first');
  assert.ok(nextWeek.keepsCents < first.keepsCents / 3);

  // Nothing bought: the second week is as dear as the first was.
  assert.ok(groceryList({ ...base, start: addDays(DAY_ONE, 7) }).totalCents > nextWeek.totalCents);
});

test('stock is what was bought less what the planned meals have used', () => {
  // A 2 lb tub of whey bought on day one, then watched for three weeks.
  const tub = { id: 'w', item: 'whey', date: DAY_ONE, grams: 907, until: null, home: false, skip: [] };
  const usedBy = (date) => periodMeals({ start: DAY_ONE, days: Math.max(0, Math.round((Date.parse(date) - Date.parse(DAY_ONE)) / 86400000)), kcalFor: () => 1800 })
    .flatMap(({ meal }) => meal.items).filter(([food]) => food === 'whey').reduce((sum, [, grams]) => sum + grams, 0);
  for (const days of [1, 7, 14, 21]) {
    const date = addDays(DAY_ONE, days);
    const stock = stockAt({ ...base, start: date, lots: [tub] });
    const expected = 907 - usedBy(date);
    assert.ok(expected > 0);
    near(stock.get('whey').reduce((sum, lot) => sum + lot.grams, 0), expected);
  }
  // On the day it was ticked it is still in the cart, not on the shelf.
  assert.equal(stockAt({ ...base, lots: [tub] }).size, 0);
  // Marked as at home instead, it counts at once.
  near(stockAt({ ...base, lots: [{ ...tub, home: true }] }).get('whey')[0].grams, 907);
  // A purchase dated in the future, or of something unknown, is ignored.
  assert.equal(stockAt({ ...base, lots: [{ ...tub, date: addDays(DAY_ONE, 3) }] }).size, 0);
  assert.equal(stockAt({ ...base, start: addDays(DAY_ONE, 3), lots: [{ ...tub, item: 'unicorn' }, { ...tub, grams: -5 }, { ...tub, date: 'someday' }] }).size, 0);

  // Meals already eaten when it was bought did not come out of it.
  const monday = '2026-11-30'; // breakfast is overnight oats, 30 g of whey
  assert.equal(planForDate(monday, 1800).slots[0].meal.id, 'b-oats');
  const dayUse = periodMeals({ start: monday, days: 1, kcalFor: () => 1800 }).flatMap(({ slot, meal }) => meal.items.filter(([food]) => food === 'whey').map(([, grams]) => [slot, grams]));
  const all = dayUse.reduce((sum, [, grams]) => sum + grams, 0);
  const afterBreakfast = dayUse.filter(([slot]) => slot !== 'breakfast').reduce((sum, [, grams]) => sum + grams, 0);
  assert.ok(all > afterBreakfast);
  const next = addDays(monday, 1);
  near(stockAt({ ...base, start: next, lots: [{ ...tub, date: monday }] }).get('whey')[0].grams, 907 - all);
  near(stockAt({ ...base, start: next, lots: [{ ...tub, date: monday, skip: ['breakfast'] }] }).get('whey')[0].grams, 907 - afterBreakfast);

  // Fresh food stops counting after the days it was bought for.
  const chicken = { id: 'c', item: 'chicken-breast', date: DAY_ONE, grams: 2000, until: addDays(DAY_ONE, 6), home: false, skip: [] };
  assert.ok(stockAt({ ...base, start: addDays(DAY_ONE, 6), lots: [chicken] }).has('chicken-breast'));
  assert.equal(stockAt({ ...base, start: addDays(DAY_ONE, 7), lots: [chicken] }).has('chicken-breast'), false);
  // And cannot feed days past that, even inside a list.
  const straddling = groceryList({ ...base, start: addDays(DAY_ONE, 4), lots: [chicken] });
  assert.equal(line(straddling, 'chicken-breast').partly, true);
  assert.ok(line(straddling, 'chicken-breast').from > addDays(DAY_ONE, 6));

  // Purchases older than about a year are forgotten.
  assert.equal(stockAt({ ...base, start: addDays(DAY_ONE, 500), lots: [{ ...tub, grams: 1e6 }] }).size, 0);
});

test('marking something as at home takes it off the list; saying it ran out puts it back', () => {
  const first = groceryList(base);
  const oil = line(first, 'olive-oil');
  const lots = [{ id: 'o', item: 'olive-oil', date: DAY_ONE, grams: oil.covers, until: null, home: true, skip: [] }];
  const marked = groceryList({ ...base, lots });
  assert.equal(line(marked, 'olive-oil'), undefined);
  assert.equal(marked.totalCents, first.totalCents - oil.cents);
  const home = marked.atHome.find((h) => h.id === 'olive-oil');
  near(home.left, oil.covers - oil.grams, 0.5);
  near(marked.stockGrams.get('olive-oil'), oil.covers, 0.5);
  // With the record removed it is back exactly as it was.
  assert.deepEqual(seen(groceryList({ ...base, lots: [] })), seen(first));

  // Half of what is needed at home: the list buys the rest and says so.
  const turkey = line(first, 'ground-turkey');
  const some = groceryList({ ...base, lots: [{ id: 't', item: 'ground-turkey', date: DAY_ONE, grams: turkey.grams / 2, until: base.start, home: true, skip: [] }] });
  assert.equal(line(some, 'ground-turkey').partly, true);
  assert.ok(line(some, 'ground-turkey').grams < turkey.grams);
});

// ------------------------------------------------------------ budget

/** Apply the suggested moves the way the app does, and return the new input. */
function applied(input, moves) {
  const prefs = { ...input.prefs };
  const swaps = JSON.parse(JSON.stringify(input.swaps || {}));
  for (const move of moves) {
    if (move.kind === 'brand') delete prefs[move.itemId];
    else swaps[move.date] = { ...(swaps[move.date] || {}), [move.slot]: move.toId };
  }
  return { ...input, prefs, swaps };
}

test('a budget with room, and no budget at all', () => {
  const list = groceryList(base);
  for (const budget of [null, undefined, 0, -5, 'lots']) {
    const fit = fitBudget({ ...base, budget });
    assert.equal(fit.status, 'none');
    assert.deepEqual(fit.moves, []);
    assert.equal(fit.afterCents, list.totalCents);
  }
  const roomy = fitBudget({ ...base, budget: list.totalCents / 100 + 10 });
  assert.equal(roomy.status, 'within');
  assert.deepEqual(roomy.moves, []);
  assert.equal(roomy.overCents, 0);
  assert.equal(fitBudget({ ...base, budget: list.totalCents / 100 }).status, 'within'); // exactly on budget is within it
  assert.deepEqual(seen(roomy.list), seen(list));
});

test('over budget: cheaper brands first, largest saving first, never one marked to keep', () => {
  const offers = [
    { id: 'a', item: 'greek-yogurt', store: 'walmart', brand: 'Fage', unit: 'oz', size: 32, price: 6.99 },
    { id: 'b', item: 'olive-oil', store: 'walmart', brand: 'Bertolli', unit: 'fl oz', size: 16.9, price: 12.98 },
    { id: 'c', item: 'oats', store: 'walmart', brand: 'Quaker', unit: 'oz', size: 42, price: 4.58 },
  ];
  const prefs = { 'greek-yogurt': { brand: 'Fage' }, 'olive-oil': { brand: 'Bertolli' }, oats: { brand: 'Quaker' } };
  const input = { ...base, offers, prefs };
  const total = groceryList(input).totalCents;
  assert.equal(total, groceryList(base).totalCents + 220 + 600 + 10);

  // $5 over: the olive oil alone (saves $6.00) closes it.
  const one = fitBudget({ ...input, budget: (total - 500) / 100 });
  assert.equal(one.status, 'fits');
  assert.equal(one.overCents, 500);
  assert.deepEqual(one.moves, [{ kind: 'brand', itemId: 'olive-oil', name: 'Olive oil', from: 'Bertolli', to: '', saving: 600 }]);
  assert.equal(one.afterCents, total - 600);

  // $7 over: the oil, then the yogurt. The 10 cent saving on oats is never worth suggesting.
  const two = fitBudget({ ...input, budget: (total - 700) / 100 });
  assert.deepEqual(two.moves.map((m) => [m.itemId, m.saving]), [['olive-oil', 600], ['greek-yogurt', 220]]);
  assert.equal(two.status, 'fits');
  assert.equal(two.afterCents, total - 820);
  assert.equal(groceryList(applied(input, two.moves)).totalCents, two.afterCents);

  // $8.25 over: both brands are not enough. The oats would add 10 cents, which is
  // under the 25 cent floor, so the oats are left alone and meals make up the rest.
  const three = fitBudget({ ...input, budget: (total - 825) / 100 });
  assert.deepEqual(three.moves.slice(0, 2).map((m) => m.itemId), ['olive-oil', 'greek-yogurt']);
  assert.ok(three.moves.length > 2);
  assert.ok(three.moves.slice(2).every((m) => m.kind === 'meal'));
  assert.equal(groceryList(applied(input, three.moves)).totalCents, three.afterCents);

  // Keep the oil: it is never offered up, so the yogurt goes first and meals have to help.
  const kept = fitBudget({ ...input, prefs: { ...prefs, 'olive-oil': { brand: 'Bertolli', keep: true } }, budget: (total - 500) / 100 });
  assert.equal(kept.moves[0].itemId, 'greek-yogurt');
  assert.ok(kept.moves.every((m) => m.itemId !== 'olive-oil'));
  assert.ok(kept.moves.slice(1).every((m) => m.kind === 'meal'));
});

test('over budget: then cheaper meals, within limits, and the figure shown is exact', () => {
  const list = groceryList(base);
  const target = 150;
  for (const cut of [1000, 2500, 4000, 15000]) {
    const input = { ...base, budget: (list.totalCents - cut) / 100 };
    const fit = fitBudget(input);
    assert.equal(fit.overCents, cut);
    const mealMoves = fit.moves.filter((m) => m.kind === 'meal');
    assert.equal(mealMoves.length, fit.moves.length);
    assert.ok(mealMoves.length >= 1 && mealMoves.length <= 4);
    assert.equal(fit.status, fit.afterCents <= fit.budgetCents ? 'fits' : 'short');

    // The total promised is the total the list shows once the moves are made.
    const after = groceryList(applied(input, fit.moves));
    assert.equal(after.totalCents, fit.afterCents);
    assert.equal(fit.list.totalCents - fit.moves.reduce((sum, m) => sum + m.saving, 0), fit.afterCents);

    const swaps = {};
    for (const move of mealMoves) {
      assert.ok(move.saving >= 100, 'each change saves at least a dollar');
      assert.ok(['breakfast', 'lunch', 'dinner'].includes(move.slot));
      assert.ok(move.date >= base.start && move.date <= list.end);
      assert.notEqual(move.fromId, move.toId);
      // The day keeps its protein and calories.
      const before = planForDate(move.date, 1800, swaps[move.date] || {});
      swaps[move.date] = { ...(swaps[move.date] || {}), [move.slot]: move.toId };
      const now = planForDate(move.date, 1800, swaps[move.date]);
      assert.ok(now.protein >= Math.min(before.protein, target) - 10, `${move.date} ${move.slot}: protein ${before.protein} -> ${now.protein}`);
      assert.ok(Math.abs(now.kcal - before.kcal) <= 100, `${move.date} ${move.slot}: kcal ${before.kcal} -> ${now.kcal}`);
    }
    // No meal lands on the day next to itself, or more than twice in the list.
    const dinners = [];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(base.start, i);
      dinners.push(planForDate(date, 1800, swaps[date] || {}).slots.find((s) => s.slot === 'dinner').meal.id);
    }
    for (const move of mealMoves.filter((m) => m.slot === 'dinner')) {
      assert.ok(dinners.filter((id) => id === move.toId).length <= 2, `${move.toId} appears too often`);
      const at = Math.round((Date.parse(move.date) - Date.parse(base.start)) / 86400000);
      assert.notEqual(dinners[at - 1], move.toId);
      assert.notEqual(dinners[at + 1], move.toId);
    }
  }
  // A budget no change can reach is reported as short, with what the moves do save.
  const hopeless = fitBudget({ ...base, budget: 20 });
  assert.equal(hopeless.status, 'short');
  assert.ok(hopeless.afterCents > hopeless.budgetCents);
  assert.ok(hopeless.afterCents < list.totalCents);
});

test('meal suggestions hold their limits in every corner of the rotation', () => {
  // One open meal on one day, for every day of the two weeks and every meal slot,
  // each time 50 cents over budget. Whatever is suggested must be worth a dollar
  // and must not cost the day more than 10 g of protein or 100 calories.
  const everySlot = ['breakfast', 'lunch', 'snack', 'dinner', 'morningSnack'];
  let suggested = 0;
  let declined = 0;
  for (let i = 0; i < 14; i += 1) {
    const date = addDays('2026-11-30', i);
    for (const open of ['breakfast', 'lunch', 'dinner']) {
      const input = { ...base, start: date, days: 1, logged: { [date]: everySlot.filter((slot) => slot !== open && slot !== 'snack') }, proteinFor: () => 999 };
      const total = groceryList(input).totalCents;
      const fit = fitBudget({ ...input, budget: (total - 50) / 100 });
      if (!fit.moves.length) declined += 1;
      for (const move of fit.moves) {
        suggested += 1;
        assert.equal(move.slot, open, 'only the open meal may change');
        assert.ok(move.saving >= 100, `${date} ${open}: a ${move.saving} cent saving is not worth a change`);
        const before = planForDate(date, 1800);
        const after = planForDate(date, 1800, { [open]: move.toId });
        assert.ok(after.protein >= before.protein - 10, `${date} ${open}: protein ${before.protein} -> ${after.protein}`);
        assert.ok(Math.abs(after.kcal - before.kcal) <= 100);
      }
      assert.equal(groceryList(applied(input, fit.moves)).totalCents, fit.afterCents);
    }
  }
  assert.ok(suggested > 10, `${suggested} suggestions`);
  assert.ok(declined > 0, 'somewhere, no change was worth making');
});

test('once shopping has started, what is in the cart is left alone', () => {
  const offers = [
    { id: 'a', item: 'greek-yogurt', store: 'walmart', brand: 'Fage', unit: 'oz', size: 32, price: 6.99 },
    { id: 'b', item: 'olive-oil', store: 'walmart', brand: 'Bertolli', unit: 'fl oz', size: 16.9, price: 12.98 },
  ];
  const prefs = { 'greek-yogurt': { brand: 'Fage' }, 'olive-oil': { brand: 'Bertolli' } };
  const input = { ...base, offers, prefs };
  const before = groceryList(input);
  const oil = line(before, 'olive-oil');
  const tick = (l) => ({ id: `t-${l.id}`, item: l.id, date: DAY_ONE, grams: l.covers, until: l.item.keeps ? null : before.end, home: false, skip: [] });

  // Nothing ticked: both brands and then meals are on offer.
  const open = fitBudget({ ...input, budget: 100 });
  assert.equal(open.shopping, false);
  assert.deepEqual(open.moves.slice(0, 2).map((m) => m.itemId), ['olive-oil', 'greek-yogurt']);
  assert.ok(open.moves.some((m) => m.kind === 'meal'));

  // The oil is in the cart: only the yogurt's brand is suggested, and no meal.
  const shopping = fitBudget({ ...input, lots: [tick(oil)], budget: 100 });
  assert.equal(shopping.shopping, true);
  assert.equal(shopping.list.totalCents, before.totalCents, 'the ticked item still counts toward the checkout');
  assert.deepEqual(shopping.moves, [{ kind: 'brand', itemId: 'greek-yogurt', name: 'Greek yogurt, nonfat plain', from: 'Fage', to: '', saving: 220 }]);
  assert.equal(shopping.status, 'short');
  assert.equal(shopping.afterCents, before.totalCents - 220);

  // The shared text is what is still to buy.
  const text = listAsText(shopping.list);
  assert.ok(!text.includes('Olive oil'));
  assert.ok(text.includes('- Greek yogurt, nonfat plain: 32 oz, Fage'));
  assert.ok(text.split('\n')[1] === `Walmart, about ${formatMoney(before.totalCents - oil.cents)}`);
  const allTicked = groceryList({ ...input, lots: before.lines.map(tick) });
  assert.equal(listAsText(allTicked).split('\n')[1], 'Walmart. Everything is in the cart or at home.');
  assert.ok(!listAsText(allTicked).includes('PRODUCE'));
});

test('budget suggestions leave alone meals already eaten and respect what is at home', () => {
  // The three meals of every day are logged and only snacks are left to buy for.
  // Changing a meal that is already eaten would change the snack that fits the
  // day, and so the bill, but it is not a change anyone can make.
  const mains = {};
  for (let i = 0; i < 7; i += 1) mains[addDays(DAY_ONE, i)] = ['breakfast', 'lunch', 'dinner'];
  const snacksOnly = fitBudget({ ...base, logged: mains, budget: 1 });
  assert.ok(snacksOnly.list.lines.length > 0);
  assert.deepEqual(snacksOnly.moves, []);
  assert.equal(snacksOnly.status, 'short');

  // Everything logged for the whole list: nothing to buy, nothing to suggest.
  const logged = {};
  for (let i = 0; i < 7; i += 1) logged[addDays(DAY_ONE, i)] = ['breakfast', 'lunch', 'snack', 'dinner', 'morningSnack'];
  const done = fitBudget({ ...base, logged, budget: 1 });
  assert.equal(done.list.lines.length, 0);
  assert.equal(done.status, 'within');

  // Three days logged in full: no suggestion touches them.
  const early = {};
  for (let i = 0; i < 3; i += 1) early[addDays(DAY_ONE, i)] = ['breakfast', 'lunch', 'snack', 'dinner'];
  const fit = fitBudget({ ...base, logged: early, budget: 40 });
  assert.ok(fit.moves.length >= 1);
  for (const move of fit.moves) assert.ok(move.date > addDays(DAY_ONE, 2));
  assert.equal(groceryList(applied({ ...base, logged: early }, fit.moves)).totalCents, fit.afterCents);

  // With a full first shop at home, the second week's suggestions still add up.
  const lots = boughtAll(groceryList(base));
  const week2 = { ...base, start: addDays(DAY_ONE, 7), lots };
  const total = groceryList(week2).totalCents;
  const second = fitBudget({ ...week2, budget: (total - 2000) / 100 });
  assert.equal(groceryList(applied(week2, second.moves)).totalCents, second.afterCents);
  assert.ok(second.afterCents < total);
});

// ------------------------------------------------------------ sharing and saving

test('the list as text', () => {
  const text = listAsText(groceryList(base));
  const lines = text.split('\n');
  assert.equal(lines[0], 'Grocery list for Wed, Nov 25 to Tue, Dec 1 (7 days of meals)');
  assert.ok(/^Walmart, about \$\d+\.\d\d$/.test(lines[1]), lines[1]);
  assert.ok(lines.includes('PRODUCE') && lines.includes('PANTRY'));
  assert.ok(lines.includes('- Salmon fillet: ½ lb'));
  assert.ok(lines.includes('- Greek yogurt, nonfat plain: 32 oz tub'));
  assert.ok(lines.includes('- Whey protein powder: 2 lb tub (check the label)'));
  const branded = listAsText(groceryList({ ...base, prefs: { whey: { brand: 'Optimum' } } })).split('\n');
  assert.ok(branded.includes('- Whey protein powder: 2 lb tub, Optimum (check the label)'));
  assert.ok(lines[lines.length - 1].startsWith('Seasonings the recipes use: garlic'));
});

test('stores you add sit after the ones in the price list', () => {
  const custom = [{ id: 'my-corner', name: 'Corner Market', brand: '' }, { id: 'walmart', name: 'Impostor' }, { name: 'no id' }];
  const stores = allStores(catalog, custom);
  assert.equal(stores.length, catalog.stores.length + 1);
  assert.equal(stores[stores.length - 1].name, 'Corner Market');
  assert.equal(stores.find((s) => s.id === 'walmart').name, 'Walmart');
  const list = groceryList({ ...base, customStores: custom, storeId: 'my-corner' });
  assert.equal(list.store.name, 'Corner Market');
  assert.equal(list.store.brand, ''); // a store with no brand of its own
  assert.equal(line(list, 'greek-yogurt').cents, 479);
});

test('saved grocery choices survive a round trip and junk is dropped', () => {
  // A backup from before the grocery list existed still loads, with everything it had.
  const old = normalizeState({
    settings: { bmr: 1900, startWeight: 230, goalWeight: 200, startDate: DAY_ONE, targetDate: '2027-03-25', kcalTarget: 2050, proteinTarget: 145 },
    log: [{ id: 'a', date: DAY_ONE, slot: 'breakfast', kcal: 400, name: 'Oats' }],
    weights: [{ date: DAY_ONE, lb: 230 }],
    swaps: { [DAY_ONE]: { dinner: 'd-cod' } },
  });
  assert.equal(old.settings.kcalTarget, 2050);
  assert.equal(old.log.length, 1);
  assert.equal(old.weights.length, 1);
  assert.deepEqual(old.swaps, { [DAY_ONE]: { dinner: 'd-cod' } });
  assert.deepEqual(old.grocery, { store: null, days: 7, budget: null, servings: 1, prefs: {}, offers: [], lots: [], stores: [], typical: {}, hidden: [] });

  const grocery = {
    store: 'target', days: 14, budget: 135.5, servings: 4,
    prefs: { 'greek-yogurt': { brand: 'Fage', keep: true } },
    offers: [{ id: 'p', item: 'greek-yogurt', store: 'target', brand: 'Fage', unit: 'oz', size: 32, price: 6.99, date: DAY_ONE }],
    lots: [{ id: 'l', item: 'whey', date: DAY_ONE, grams: 907, until: null, home: true, skip: ['breakfast'] }],
    stores: [{ id: 'my-corner', name: 'Corner Market', brand: '' }],
    typical: { oats: { unit: 'oz', size: 42, price: 3.98 } },
    hidden: ['costco'],
  };
  assert.deepEqual(normalizeState({ grocery }).grocery, grocery);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(normalizeState({ grocery })))).grocery, grocery);

  const junk = normalizeState({
    grocery: {
      store: 42, days: 5, budget: -3, servings: 40,
      prefs: { a: 'Fage', b: { brand: '   ' }, c: { brand: 'Ok', keep: 'yes' } },
      offers: [{ item: 'x' }, 'no', { item: 'x', store: 's', unit: 'oz', price: 0 }, { item: 'x', store: 's', unit: 'oz', price: 2 }],
      lots: [{ item: 'x', date: 'yesterday', grams: 5 }, { item: 'x', date: DAY_ONE, grams: 0 }, { item: 'x', date: DAY_ONE, grams: 5, until: 'soon', skip: 'breakfast' }],
      stores: [{ id: 'a', name: 'A' }, { id: 'a', name: 'Again' }, { id: 'b' }],
    },
  }).grocery;
  assert.deepEqual([junk.store, junk.days, junk.budget, junk.servings], [null, 7, null, 1]);
  assert.deepEqual(junk.prefs, { c: { brand: 'Ok', keep: false } });
  assert.equal(junk.offers.length, 1);
  assert.equal(junk.offers[0].size, 1);
  assert.equal(junk.lots.length, 1);
  assert.deepEqual([junk.lots[0].until, junk.lots[0].home, junk.lots[0].skip], [null, false, []]);
  assert.deepEqual(junk.stores, [{ id: 'a', name: 'A', brand: '' }]);
});
