// The grocery list: what to buy for the planned meals, in which package, what
// it should cost, and how to get under a budget.
//
// Everything in this file is a pure function of what is passed in. There is
// no clock, no randomness and no network here, and every choice between equals
// is settled by a fixed rule, so the same plan, price list, store, brand
// choices, purchases and budget always give the same list in the same order.
//
// The rules, in the order they apply:
//   1. Needs. Add up every ingredient of every planned meal in the period,
//      skipping meals already logged as eaten, and convert recipe grams to
//      grams you buy (raw meat, dry rice, whole cans, fruit with the peel).
//   2. Stock. Take off what is already at home: what you ticked or marked on
//      earlier days, less what the planned meals have used since. Food that
//      keeps (pantry, frozen, eggs) stays in stock until it is used up; fresh
//      food only counts for the days it was bought for.
//   3. Prices. At the chosen store, a price you recorded beats the typical
//      price from the price list. Typical prices are not any store's prices.
//   4. Product. With no brand set, take the offer that covers the need for the
//      least money. With a brand set, take that brand: its price at this
//      store, else its price at another store, else the typical price.
//   5. Budget. If the total is over, suggest cheaper brands first (largest
//      saving first, never a brand marked "keep"), then cheaper meals that
//      hold the day's protein and calories. What is already in the cart is
//      left alone, and once shopping has started no meal change is suggested.
//      Nothing changes until applied.

import { addDays, formatDay, isValidDate, planForDate } from './core.js';
import { mealsForSlot } from './meals.js';
import { nutWordIn } from './allergens.js';

export const AISLES = ['Produce', 'Meat and seafood', 'Dairy and eggs', 'Deli', 'Bakery', 'Pantry', 'Frozen'];
export const DAY_CHOICES = [3, 7, 14];
export const MAX_SERVINGS = 6;
export const PER_LB = 'per lb';
export const STORE_BRAND = '@store'; // brand choice meaning "whatever this store's own brand is"

const KEEPING_AISLES = ['Pantry', 'Frozen'];
const G_PER_LB = 453.59237;
const WEIGHT_G = { oz: 28.349523125, lb: G_PER_LB, g: 1, kg: 1000 };
const VOLUME_ML = { 'fl oz': 29.5735295625, ml: 1, L: 1000, gal: 3785.411784 };

const SHORT_OK = 0.05; // a package may fall this far short of the amount a recipe needs
const QUARTER_LB = 0.25; // food sold by weight is bought in quarter pounds
const MAX_STOCK_DAYS = 400; // purchases older than this are forgotten
const MIN_BRAND_SAVING = 25; // cents; a smaller saving is not worth suggesting
const MIN_MEAL_SAVING = 100; // cents
const MAX_MEAL_MOVES = 4; // suggest at most this many meal changes
const PROTEIN_SLACK = 10; // grams of protein a suggested meal may cost the day
const KCAL_SLACK = 100; // calories a suggested meal may move the day. Today's meals differ by less than
// this within a slot, so the rule cannot fire yet; it guards later edits to js/meals.js.
const MAX_REPEATS = 2; // times one meal may sit in the same slot of a list after suggestions
const MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];
const SLOT_ORDER = ['breakfast', 'morningSnack', 'lunch', 'snack', 'dinner'];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const brandKey = (brand) => text(brand, 60).toLowerCase();
const byName = (a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id);

// ---------------------------------------------------------------- formatting

/** 1240 -> '$12.40' */
export function formatMoney(cents) {
  const value = Math.round(Math.abs(cents));
  const dollars = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(value % 100).padStart(2, '0')}`;
}

const QUARTERS = { 0: '', 1: '¼', 2: '½', 3: '¾' };

/** 1.5 -> '1½ lb' */
export function poundsText(lbs) {
  const quarters = Math.round(lbs * 4);
  const whole = Math.floor(quarters / 4);
  return `${whole || ''}${QUARTERS[quarters % 4]}${quarters === 0 ? '0' : ''} lb`;
}

function pieces(planGrams, each) {
  return Math.max(1, Math.ceil(planGrams / each - 0.1));
}

/**
 * An amount of an item in the unit you would think of it in.
 * grams are grams as bought; planGrams are grams as the recipes count them.
 */
export function amountText(item, grams, planGrams) {
  if (item.piece && item.each) {
    const n = pieces(planGrams, item.each);
    return `${n} ${n === 1 ? item.piece[0] : item.piece[1]}`;
  }
  if (item.gPerMl) {
    const flOz = grams / item.gPerMl / VOLUME_ML['fl oz'];
    return `${flOz < 10 ? Math.max(0.5, Math.round(flOz * 2) / 2) : Math.round(flOz)} fl oz`;
  }
  if (grams < G_PER_LB) return `${Math.max(1, Math.round(grams / WEIGHT_G.oz))} oz`;
  return `${(Math.round((grams / G_PER_LB) * 10) / 10).toFixed(1)} lb`;
}

// ---------------------------------------------------------------- the price list

/** Grams in a package of this size, or null if the unit does not suit the item. */
export function sizeInGrams(item, size, unit) {
  const n = Number(size);
  if (!(n > 0)) return null;
  if (WEIGHT_G[unit]) return n * WEIGHT_G[unit];
  if (VOLUME_ML[unit]) return item.gPerMl ? n * VOLUME_ML[unit] * item.gPerMl : null;
  if (unit === 'count') return item.each ? n * item.each : null;
  return null;
}

/** The units a price for this item can be given in. */
export function unitsFor(item) {
  const units = [PER_LB, 'oz', 'lb', 'g', 'kg'];
  if (item.gPerMl) units.push('fl oz', 'ml', 'L', 'gal');
  if (item.each) units.push('count');
  return units;
}

function packLabel(size, unit, form) {
  const n = String(Math.round(size * 100) / 100);
  if (unit === 'count') return size === 1 ? 'each' : `pack of ${n}`;
  return `${n} ${unit}${form ? ` ${form}` : ''}`;
}

/**
 * Turn a size, a unit and a price in dollars into something the list can
 * cost, or null if it makes no sense for this item.
 * 'per lb' is food sold by weight; anything else is a package.
 */
export function makeOffer(item, { unit, size, price, label, form }) {
  const cents = Math.round(Number(price) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  if (unit === PER_LB) return { kind: 'weight', grams: G_PER_LB, cents, unit, size: 1, label: PER_LB };
  const grams = sizeInGrams(item, size, unit);
  if (!grams) return null;
  return { kind: 'pack', grams, cents, unit, size: Number(size), label: text(label, 40) || packLabel(Number(size), unit, text(form, 20)) };
}

function readStores(list, problems) {
  const stores = [];
  const seen = new Set();
  for (const entry of Array.isArray(list) ? list : []) {
    const id = isObject(entry) ? text(entry.id, 40) : '';
    const name = isObject(entry) ? text(entry.name, 40) : '';
    if (!id || !name) {
      problems.push('A store has no id or name.');
    } else if (seen.has(id)) {
      problems.push(`Store "${id}" is listed twice.`);
    } else {
      seen.add(id);
      stores.push({ id, name, brand: text(entry.brand, 40) });
    }
  }
  return stores;
}

function readItem(entry, problems) {
  if (!isObject(entry)) return null;
  const id = text(entry.id, 40);
  const name = text(entry.name, 80);
  if (!id || !name) {
    problems.push('An item has no id or name.');
    return null;
  }
  if (!AISLES.includes(entry.aisle)) {
    problems.push(`Item "${id}" has an unknown aisle.`);
    return null;
  }
  const foods = {};
  for (const [food, factor] of Object.entries(isObject(entry.foods) ? entry.foods : {})) {
    if (positive(factor)) foods[food] = positive(factor);
    else problems.push(`Item "${id}" has a bad amount for "${food}".`);
  }
  if (!Object.keys(foods).length) {
    problems.push(`Item "${id}" covers no food.`);
    return null;
  }
  const piece = Array.isArray(entry.piece) && entry.piece.length === 2 ? entry.piece.map((word) => text(word, 30)) : null;
  const item = {
    id,
    name,
    aisle: entry.aisle,
    foods,
    fresh: entry.fresh === true, // sold loose or unbranded, so "store brand" is not offered as a choice
    check: entry.check === true, // a kind of packaged food that more often carries nut warnings
    // Food that keeps stays in stock until the meals use it up. Anything else
    // only counts for the days it was bought for.
    keeps: typeof entry.keeps === 'boolean' ? entry.keeps : KEEPING_AISLES.includes(entry.aisle),
    gPerMl: positive(entry.gPerMl),
    each: positive(entry.each),
    piece: piece && piece[0] && piece[1] ? piece : null,
    as: text(entry.as, 120),
    typical: [],
  };
  for (const price of Array.isArray(entry.typical) ? entry.typical : []) {
    const offer = isObject(price) ? makeOffer(item, price) : null;
    if (offer) item.typical.push({ ...offer, src: text(price.src, 20) || 'est', note: text(price.note, 160) });
    else problems.push(`Item "${id}" has a price that cannot be read.`);
  }
  if (!item.typical.length) {
    problems.push(`Item "${id}" has no typical price.`);
    return null;
  }
  return item;
}

/**
 * Check the price list (data/groceries.json) and index it.
 * Returns { catalog, problems }. catalog is null when nothing usable is left.
 */
export function readCatalog(raw) {
  const problems = [];
  if (!isObject(raw) || !Array.isArray(raw.stores) || !Array.isArray(raw.items)) {
    return { catalog: null, problems: ['The price list needs a "stores" list and an "items" list.'] };
  }
  const stores = readStores(raw.stores, problems);
  const items = [];
  const itemById = new Map();
  const itemForFood = new Map();
  for (const entry of raw.items) {
    const item = readItem(entry, problems);
    if (!item) continue;
    if (itemById.has(item.id)) {
      problems.push(`Item "${item.id}" is listed twice.`);
      continue;
    }
    const taken = Object.keys(item.foods).find((food) => itemForFood.has(food));
    if (taken) {
      problems.push(`Food "${taken}" is covered by both "${itemForFood.get(taken).item.id}" and "${item.id}".`);
      continue;
    }
    items.push(item);
    itemById.set(item.id, item);
    for (const [food, factor] of Object.entries(item.foods)) itemForFood.set(food, { item, factor });
  }
  if (!stores.length) problems.push('The price list has no usable store.');
  if (!items.length) problems.push('The price list has no usable item.');
  if (!stores.length || !items.length) return { catalog: null, problems };

  const sources = {};
  for (const [key, value] of Object.entries(isObject(raw.sources) ? raw.sources : {})) sources[key] = text(value, 160);
  return {
    catalog: {
      updated: text(raw.updated, 10),
      sourcePage: text(raw.sourcePage, 200),
      sources,
      stores,
      items,
      itemById,
      itemForFood,
    },
    problems,
  };
}

/** The price list's stores followed by any you added yourself. */
export function allStores(catalog, custom = []) {
  const stores = [...catalog.stores];
  const seen = new Set(stores.map((s) => s.id));
  for (const store of readStores(custom, [])) {
    if (!seen.has(store.id)) {
      seen.add(store.id);
      stores.push(store);
    }
  }
  return stores;
}

export function findStore(catalog, custom, id) {
  const stores = allStores(catalog, custom);
  return stores.find((s) => s.id === id) || stores[0];
}

// ---------------------------------------------------------------- what the meals need

/**
 * Every planned meal from `start` for `days` days, leaving out the ones
 * already logged. logged: { [date]: [slot, ...] }.
 */
export function periodMeals({ start, days, kcalFor, swaps = {}, logged = {} }) {
  const meals = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const eaten = logged[date] || [];
    for (const { slot, meal } of planForDate(date, kcalFor(date), swaps[date] || {}).slots) {
      if (meal && !eaten.includes(slot)) meals.push({ date, slot, meal });
    }
  }
  return meals;
}

/** Grams of each ingredient those meals use. Dinners are multiplied by `servings`. */
export function foodNeeds(meals, servings = 1) {
  const foods = new Map();
  for (const { date, slot, meal } of meals) {
    const times = slot === 'dinner' ? servings : 1;
    for (const [food, grams] of meal.items) {
      const need = foods.get(food) || { grams: 0, uses: [] };
      need.grams += grams * times;
      need.uses.push({ date, slot, mealId: meal.id, mealName: meal.name, grams: grams * times });
      foods.set(food, need);
    }
  }
  return foods;
}

const useOrder = (a, b) => cmp(a.date, b.date) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || cmp(a.mealId, b.mealId);

/**
 * Ingredient grams turned into grams of things you buy.
 * Returns { byItem: Map id -> { grams, planGrams, uses }, unmapped: [food] }.
 * Each use carries `buy`, its share of the grams to buy.
 */
export function itemNeeds(catalog, foods) {
  const byItem = new Map();
  const unmapped = [];
  for (const [food, need] of foods) {
    const link = catalog.itemForFood.get(food);
    if (!link) {
      unmapped.push(food);
      continue;
    }
    const entry = byItem.get(link.item.id) || { grams: 0, planGrams: 0, uses: [] };
    entry.grams += need.grams * link.factor;
    entry.planGrams += need.grams;
    for (const use of need.uses) entry.uses.push({ ...use, buy: use.grams * link.factor });
    byItem.set(link.item.id, entry);
  }
  for (const entry of byItem.values()) entry.uses.sort(useOrder);
  return { byItem, unmapped: unmapped.sort() };
}

/** The needs of each day of a list, one day at a time. */
function listDays({ catalog, start, days, kcalFor, swaps = {}, logged = {}, servings = 1 }) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const meals = periodMeals({ start: date, days: 1, kcalFor, swaps, logged });
    out.push({ date, meals, ...itemNeeds(catalog, foodNeeds(meals, servings)) });
  }
  return out;
}

// Seasonings the methods mention but the recipes do not weigh. Listed so the
// shopper can check the cupboard; they are not priced.
const SEASONINGS = ['garlic', 'ginger', 'lemon', 'mustard', 'vinegar', 'chili powder', 'cumin', 'oregano', 'cinnamon'];

export function seasoningsFor(meals) {
  const all = meals.map(({ meal }) => `${meal.method} ${meal.items.map(([, , how]) => how).join(' ')}`).join(' ').toLowerCase();
  const found = SEASONINGS.filter((word) => new RegExp(`\\b${word}\\b`).test(all));
  return meals.length ? [...found, 'salt', 'pepper'] : [];
}

// ---------------------------------------------------------------- what is at home

/**
 * Purchases, checked and put in a fixed order.
 * A lot is { id, item, date, grams, until, home, skip }:
 *   date   the day it was ticked off a list or marked as at home
 *   grams  how much that was, in grams as bought
 *   until  the last day it counts for (fresh food), or null (food that keeps)
 *   home   true when marked "already at home" instead of ticked in the store
 *   skip   meals already logged that day when it was added, which it did not have to feed
 */
function readLots(catalog, lots) {
  const out = [];
  for (const raw of Array.isArray(lots) ? lots : []) {
    if (!isObject(raw) || !catalog.itemById.has(raw.item)) continue;
    if (!positive(raw.grams) || !isValidDate(raw.date)) continue;
    out.push({
      id: String(raw.id || ''),
      item: raw.item,
      date: raw.date,
      grams: positive(raw.grams),
      until: isValidDate(raw.until) ? raw.until : null,
      home: raw.home === true,
      skip: Array.isArray(raw.skip) ? raw.skip.filter((slot) => typeof slot === 'string') : [],
    });
  }
  return out.sort((a, b) => cmp(a.date, b.date) || cmp(a.item, b.item) || cmp(a.id, b.id) || a.grams - b.grams);
}

const NEVER = '9999-12-31';

function addToStock(stock, lot) {
  const lots = stock.get(lot.item) || [];
  lots.push({ grams: lot.grams, until: lot.until, date: lot.date });
  // Use up first whatever stops counting soonest, then whatever is oldest.
  lots.sort((a, b) => cmp(a.until || NEVER, b.until || NEVER) || cmp(a.date, b.date));
  stock.set(lot.item, lots);
}

/** Take grams of an item out of stock on a date. Returns what stock could not supply. */
function draw(stock, id, date, grams) {
  let missing = grams;
  for (const lot of stock.get(id) || []) {
    if (missing <= 0) break;
    if (lot.until && lot.until < date) continue;
    const taken = Math.min(lot.grams, missing);
    lot.grams -= taken;
    missing -= taken;
  }
  return missing;
}

/**
 * What is at home on the morning a list starts: every earlier purchase, less
 * what the planned meals have used since it was made. Things ticked on the
 * start day itself are still in the cart, so they are left out; things marked
 * "at home" that day count at once.
 * Returns Map item id -> [{ grams, until, date }].
 */
export function stockAt({ catalog, lots = [], start, kcalFor, swaps = {}, servings = 1 }) {
  const stock = new Map();
  const floor = addDays(start, -MAX_STOCK_DAYS);
  const usable = readLots(catalog, lots).filter((lot) => lot.date >= floor && (lot.date < start || (lot.date === start && lot.home)));
  if (!usable.length) return stock;

  for (let date = usable[0].date; date < start; date = addDays(date, 1)) {
    const arriving = usable.filter((lot) => lot.date === date);
    const usage = new Map();
    for (const [id, need] of itemNeeds(catalog, foodNeeds(periodMeals({ start: date, days: 1, kcalFor, swaps }), servings)).byItem) {
      usage.set(id, need.uses);
    }
    for (const id of new Set([...stock.keys(), ...arriving.map((lot) => lot.item)])) {
      const mine = arriving.filter((lot) => lot.item === id);
      const eatenFirst = new Set(mine.flatMap((lot) => lot.skip));
      const uses = usage.get(id) || [];
      const before = uses.filter((use) => eatenFirst.has(use.slot)).reduce((sum, use) => sum + use.buy, 0);
      const after = uses.filter((use) => !eatenFirst.has(use.slot)).reduce((sum, use) => sum + use.buy, 0);
      draw(stock, id, date, before); // meals eaten before the shopping trip came out of older stock
      for (const lot of mine) addToStock(stock, lot);
      draw(stock, id, date, after);
    }
  }
  for (const lot of usable) {
    if (lot.date === start) addToStock(stock, lot);
  }
  for (const [id, held] of stock) {
    const kept = held.filter((lot) => lot.grams > 1e-6 && (!lot.until || lot.until >= start));
    if (kept.length) stock.set(id, kept);
    else stock.delete(id);
  }
  return stock;
}

/**
 * Feed each day of a list from stock. What stock cannot supply has to be bought.
 * Returns Map item id -> { need, planNeed, buy, from, left, uses }: grams needed,
 * grams to buy, the first day something is missing, and grams left at the end.
 */
function shortfalls(days, opening) {
  const stock = new Map([...opening].map(([id, lots]) => [id, lots.map((lot) => ({ ...lot }))]));
  const out = new Map();
  for (const { date, byItem } of days) {
    for (const [id, need] of byItem) {
      const entry = out.get(id) || { need: 0, planNeed: 0, buy: 0, from: null, left: 0, uses: [] };
      const missing = draw(stock, id, date, need.grams);
      entry.need += need.grams;
      entry.planNeed += need.planGrams;
      entry.uses.push(...need.uses);
      if (missing > 1e-6) {
        entry.buy += missing;
        if (!entry.from) entry.from = date;
      }
      out.set(id, entry);
    }
  }
  for (const [id, entry] of out) entry.left = (stock.get(id) || []).reduce((sum, lot) => sum + lot.grams, 0);
  return out;
}

const mustBuy = (entry) => entry.buy > entry.need * SHORT_OK;

// ---------------------------------------------------------------- choosing what to buy

/** Prices you recorded, checked and grouped by item, in a fixed order. */
function readRecorded(catalog, offers) {
  const byItem = new Map();
  for (const raw of Array.isArray(offers) ? offers : []) {
    const item = isObject(raw) ? catalog.itemById.get(raw.item) : null;
    const offer = item ? makeOffer(item, raw) : null;
    if (!offer) continue;
    const brand = text(raw.brand, 60);
    const list = byItem.get(item.id) || [];
    list.push({
      ...offer,
      id: String(raw.id || ''),
      store: String(raw.store || ''),
      brand,
      brandKey: brandKey(brand),
      date: typeof raw.date === 'string' ? raw.date : null,
    });
    byItem.set(item.id, list);
  }
  for (const list of byItem.values()) {
    list.sort((a, b) => cmp(a.store, b.store) || cmp(a.brandKey, b.brandKey) || a.grams - b.grams || a.cents - b.cents || cmp(a.id, b.id));
  }
  return byItem;
}

/**
 * What can be bought for an item at a store: the prices recorded there, plus
 * the typical price standing in for the store's own product until you record
 * one. An offer with no brand, or the store's brand, is that own product.
 */
function candidatesAt(item, store, recorded) {
  const storeKey = brandKey(store.brand);
  const out = [];
  for (const offer of recorded) {
    if (offer.store === store.id) out.push({ ...offer, basis: 'recorded', isDefault: !offer.brandKey || offer.brandKey === storeKey });
  }
  if (!out.some((offer) => offer.isDefault)) {
    for (const typical of item.typical) {
      out.push({ ...typical, basis: 'typical', isDefault: true, brand: '', brandKey: '', store: store.id, id: '', date: null });
    }
  }
  return out;
}

/** The offers to choose among, given the brand choice for the item. */
function poolsFor(item, store, recorded, pref) {
  const all = candidatesAt(item, store, recorded);
  const wanted = pref && typeof pref.brand === 'string' ? text(pref.brand, 60) : '';
  if (!wanted) return { all, pool: all, preferred: false };
  const key = brandKey(wanted);
  const storeKey = brandKey(store.brand);
  if (wanted === STORE_BRAND || (storeKey && key === storeKey)) {
    return { all, pool: all.filter((offer) => offer.isDefault), preferred: true };
  }
  let pool = all.filter((offer) => offer.brandKey === key);
  if (!pool.length) {
    // Not recorded at this store: borrow the brand's price from another store.
    pool = recorded.filter((offer) => offer.brandKey === key && offer.store !== store.id).map((offer) => ({ ...offer, basis: 'elsewhere', isDefault: false }));
  }
  if (!pool.length) {
    // No price for the brand anywhere yet: cost it at the typical price.
    pool = item.typical.map((typical) => ({ ...typical, basis: 'guess', isDefault: false, brand: wanted, brandKey: key, store: store.id, id: '', date: null }));
  }
  return { all, pool, preferred: true };
}

/** How many packages (or pounds) of an offer cover a need, and what that costs. */
function fill(offer, grams) {
  const need = grams * (1 - SHORT_OK);
  if (offer.kind === 'weight') {
    const qty = Math.max(QUARTER_LB, Math.ceil(need / G_PER_LB / QUARTER_LB - 1e-9) * QUARTER_LB);
    return { offer, qty, cents: Math.round(qty * offer.cents), covers: qty * G_PER_LB };
  }
  const qty = Math.max(1, Math.ceil(need / offer.grams - 1e-9));
  return { offer, qty, cents: qty * offer.cents, covers: qty * offer.grams };
}

const BASIS_RANK = { recorded: 0, elsewhere: 1, typical: 2, guess: 3 };

// Lowest cost wins. Ties go to the lower unit price, then to a price you
// recorded, then alphabetically, so there is always exactly one winner.
function compareFills(a, b) {
  return a.cents - b.cents
    || a.offer.cents / a.offer.grams - b.offer.cents / b.offer.grams
    || BASIS_RANK[a.offer.basis] - BASIS_RANK[b.offer.basis]
    || cmp(a.offer.brandKey, b.offer.brandKey)
    || a.offer.grams - b.offer.grams
    || cmp(a.offer.label, b.offer.label)
    || cmp(a.offer.store, b.offer.store)
    || cmp(a.offer.id, b.offer.id);
}

function best(offers, grams) {
  let winner = null;
  for (const offer of offers) {
    const filled = fill(offer, grams);
    if (!winner || compareFills(filled, winner) < 0) winner = filled;
  }
  return winner;
}

// A brand is only named when you named it: one you chose, or one you recorded
// a price for. The store's own product is left unnamed, because the price list
// knows each store's main brand but not which products carry it.
const brandLabel = (offer) => offer.brand || '';

function quantityText(item, filled, planGrams) {
  const { offer, qty } = filled;
  if (offer.kind === 'weight') {
    if (item.piece && item.each) return `${amountText(item, 0, planGrams)}, about ${poundsText(qty)}`;
    return poundsText(qty);
  }
  if (offer.unit === 'count' && offer.size === 1 && item.piece) return `${qty} ${qty === 1 ? item.piece[0] : item.piece[1]}`;
  return qty === 1 ? offer.label : `${qty} × ${offer.label}`;
}

/**
 * Cost every item that has to be bought, at one store.
 * needs: Map of item id -> { grams, planGrams, uses, need?, from? } where grams
 * is what to buy and need is what the meals use in all.
 * checked: ids ticked today.
 */
export function buildList({ catalog, customStores = [], storeId, needs, prefs = {}, offers = [], checked = [] }) {
  const store = findStore(catalog, customStores, storeId);
  const recordedByItem = readRecorded(catalog, offers);
  const ticked = new Set(checked);
  const lines = [];
  for (const item of catalog.items) {
    const need = needs.get(item.id);
    if (!need || !(need.grams > 0)) continue;
    const recorded = recordedByItem.get(item.id) || [];
    const pref = isObject(prefs[item.id]) ? prefs[item.id] : null;
    const { all, pool, preferred } = poolsFor(item, store, recorded, pref);
    const pick = best(pool, need.grams);
    const cheapest = best(all, need.grams);
    const saving = pick.cents - cheapest.cents;
    const brand = brandLabel(pick.offer);
    const whole = need.need || need.grams;
    lines.push({
      id: item.id,
      item,
      name: item.name,
      aisle: item.aisle,
      grams: need.grams,
      planGrams: need.planGrams,
      uses: need.uses,
      from: need.from || null,
      partly: whole - need.grams > whole * SHORT_OK, // some of it is already at home
      offer: pick.offer,
      qty: pick.qty,
      covers: pick.covers,
      cents: pick.cents,
      usedCents: Math.round(pick.cents * Math.min(1, need.grams / pick.covers)),
      basis: pick.offer.basis,
      estimate: pick.offer.basis !== 'recorded',
      brand,
      preferred,
      keep: Boolean(pref && pref.keep),
      cheaper: preferred && saving >= MIN_BRAND_SAVING
        ? { offer: cheapest.offer, qty: cheapest.qty, cents: cheapest.cents, saving, brand: brandLabel(cheapest.offer) }
        : null,
      quantity: quantityText(item, pick, need.planGrams),
      check: item.check,
      nutWord: nutWordIn(brand),
      checked: ticked.has(item.id),
    });
  }
  lines.sort(byName);

  const sum = (list, key) => list.reduce((total, line) => total + line[key], 0);
  return {
    store,
    lines,
    groups: AISLES
      .map((aisle) => ({ aisle, lines: lines.filter((line) => line.aisle === aisle) }))
      .filter((group) => group.lines.length)
      .map((group) => ({ ...group, cents: sum(group.lines, 'cents') })),
    totalCents: sum(lines, 'cents'),
    usedCents: sum(lines, 'usedCents'),
    keepsCents: sum(lines.filter((line) => line.item.keeps), 'cents'),
    recordedCount: lines.filter((line) => !line.estimate).length,
    checkedCount: lines.filter((line) => line.checked).length,
  };
}

function assemble(input, days, opening) {
  const short = shortfalls(days, opening);
  const needs = new Map();
  const atHome = [];
  for (const [id, entry] of short) {
    const item = input.catalog.itemById.get(id);
    if (mustBuy(entry)) {
      needs.set(id, { grams: entry.buy, planGrams: (entry.planNeed * entry.buy) / entry.need, uses: entry.uses, need: entry.need, from: entry.from });
    } else {
      atHome.push({ id, item, name: item.name, aisle: item.aisle, need: entry.need, planNeed: entry.planNeed, left: entry.left, uses: entry.uses });
    }
  }
  const today = readLots(input.catalog, input.lots).filter((lot) => lot.date === input.start && !lot.home);
  const meals = days.flatMap((day) => day.meals);
  const stockGrams = new Map([...opening].map(([id, lots]) => [id, lots.reduce((sum, lot) => sum + lot.grams, 0)]));
  return {
    ...buildList({ ...input, needs, checked: today.map((lot) => lot.item) }),
    atHome: atHome.sort(byName),
    stockGrams,
    start: input.start,
    end: addDays(input.start, input.days - 1),
    days: input.days,
    meals,
    unmapped: [...new Set(days.flatMap((day) => day.unmapped))].sort(),
    seasonings: seasoningsFor(meals),
  };
}

/**
 * The whole list for a period.
 * input: { catalog, customStores, storeId, start, days, kcalFor, swaps, logged,
 *          servings, prefs, offers, lots }
 */
export function groceryList(input) {
  return assemble(input, listDays(input), stockAt(input));
}

// ---------------------------------------------------------------- fitting a budget

function cloneSwaps(swaps) {
  const out = {};
  for (const [date, slots] of Object.entries(swaps || {})) out[date] = { ...slots };
  return out;
}

/**
 * Compare the list with a budget and, when it is over, work out the changes
 * that bring it under. Nothing is applied here: the caller shows the moves and
 * applies them if asked.
 *
 * input: everything groceryList() takes, plus { budget, proteinFor }.
 * Returns { list, status, budgetCents, overCents, moves, afterCents, shopping }.
 * status: 'none' (no budget) | 'within' | 'fits' (the moves get under budget)
 *         | 'short' (they do not, or there are none)
 * shopping: something is ticked today, so only brands of unticked items are suggested
 * moves:  { kind: 'brand', itemId, name, from, to, saving }
 *         { kind: 'meal', date, slot, fromId, fromName, toId, toName, saving }
 */
export function fitBudget(input) {
  const opening = stockAt(input);
  const list = assemble(input, listDays(input), opening);
  const budgetCents = Math.round(Number(input.budget) * 100);
  const shopping = list.checkedCount > 0;
  const result = { list, status: 'none', budgetCents: 0, overCents: 0, moves: [], afterCents: list.totalCents, shopping };
  if (!Number.isFinite(budgetCents) || budgetCents <= 0) return result;
  result.budgetCents = budgetCents;
  if (list.totalCents <= budgetCents) return { ...result, status: 'within' };
  result.overCents = list.totalCents - budgetCents;

  const moves = [];
  let total = list.totalCents;

  // Step 1: brands. Each item is costed on its own, so the savings simply add up.
  const prefs = { ...(input.prefs || {}) };
  const switches = list.lines
    .filter((line) => line.cheaper && !line.keep && !line.checked)
    .sort((a, b) => b.cheaper.saving - a.cheaper.saving || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id));
  for (const line of switches) {
    if (total <= budgetCents) break;
    moves.push({ kind: 'brand', itemId: line.id, name: line.name, from: line.brand, to: line.cheaper.brand, saving: line.cheaper.saving });
    delete prefs[line.id];
    total -= line.cheaper.saving;
  }

  // Step 2: meals. Take the single change that saves the most, then look again,
  // because meals share packages and one change alters what the next is worth.
  // Not once shopping has started: a meal change then would be about food
  // that is already in the cart.
  if (total > budgetCents && !shopping) {
    const { catalog, kcalFor, logged = {} } = input;
    const proteinFor = input.proteinFor || (() => 0);
    const store = findStore(catalog, input.customStores, input.storeId);
    const recordedByItem = readRecorded(catalog, input.offers);
    const pools = new Map(catalog.items.map((item) => [
      item.id,
      poolsFor(item, store, recordedByItem.get(item.id) || [], isObject(prefs[item.id]) ? prefs[item.id] : null).pool,
    ]));
    const swaps = cloneSwaps(input.swaps);
    const dayOf = (date, daySwaps) => listDays({ ...input, start: date, days: 1, swaps: { [date]: daySwaps } })[0];
    const days = listDays({ ...input, swaps });
    const chosen = new Map(days.map(({ date }) => {
      const plan = planForDate(date, kcalFor(date), swaps[date] || {});
      return [date, Object.fromEntries(MAIN_SLOTS.map((slot) => [slot, plan.slots.find((s) => s.slot === slot).meal.id]))];
    }));

    const costWith = (changed) => {
      let cents = 0;
      for (const [id, entry] of shortfalls(days.map((day) => (day.date === changed.date ? changed : day)), opening)) {
        if (mustBuy(entry)) cents += best(pools.get(id), entry.buy).cents;
      }
      return cents;
    };

    for (let step = 0; step < MAX_MEAL_MOVES && total > budgetCents; step += 1) {
      let winner = null;
      for (const { date } of days) {
        const daySwaps = swaps[date] || {};
        const before = planForDate(date, kcalFor(date), daySwaps);
        const eaten = logged[date] || [];
        for (const slot of MAIN_SLOTS) {
          if (eaten.includes(slot)) continue;
          const current = before.slots.find((s) => s.slot === slot).meal;
          for (const alt of mealsForSlot(slot)) {
            if (alt.id === current.id) continue;
            const nextDoor = [addDays(date, -1), addDays(date, 1)].some((d) => chosen.has(d) && chosen.get(d)[slot] === alt.id);
            const already = days.filter((day) => chosen.get(day.date)[slot] === alt.id).length;
            if (nextDoor || already >= MAX_REPEATS) continue;
            const trial = { ...daySwaps, [slot]: alt.id };
            const after = planForDate(date, kcalFor(date), trial);
            if (after.protein < Math.min(before.protein, proteinFor(date)) - PROTEIN_SLACK) continue;
            if (Math.abs(after.kcal - before.kcal) > KCAL_SLACK) continue;
            const saving = total - costWith(dayOf(date, trial));
            if (saving < MIN_MEAL_SAVING) continue;
            const better = !winner
              || saving > winner.saving
              || (saving === winner.saving && (cmp(date, winner.date) || MAIN_SLOTS.indexOf(slot) - MAIN_SLOTS.indexOf(winner.slot) || cmp(alt.id, winner.toId)) < 0);
            if (better) winner = { kind: 'meal', date, slot, fromId: current.id, fromName: current.name, toId: alt.id, toName: alt.name, saving };
          }
        }
      }
      if (!winner) break;
      swaps[winner.date] = { ...(swaps[winner.date] || {}), [winner.slot]: winner.toId };
      days[days.findIndex((day) => day.date === winner.date)] = dayOf(winner.date, swaps[winner.date]);
      chosen.get(winner.date)[winner.slot] = winner.toId;
      // Re-cost the whole list the ordinary way, so the figure shown is exactly
      // what the list will say once the change is applied.
      const exact = assemble({ ...input, prefs, swaps }, days, opening).totalCents;
      moves.push({ ...winner, saving: total - exact });
      total = exact;
    }
  }

  return { ...result, status: total <= budgetCents ? 'fits' : 'short', moves, afterCents: total };
}

// ---------------------------------------------------------------- sharing

/** What is still to buy, as plain text, for Notes, Reminders or a message. */
export function listAsText(list) {
  const left = (lines) => lines.filter((line) => !line.checked);
  const cents = left(list.lines).reduce((sum, line) => sum + line.cents, 0);
  const out = [
    `Grocery list for ${formatDay(list.start)} to ${formatDay(list.end)} (${list.days} days of meals)`,
    left(list.lines).length ? `${list.store.name}, about ${formatMoney(cents)}` : `${list.store.name}. Everything is in the cart or at home.`,
  ];
  for (const group of list.groups) {
    if (!left(group.lines).length) continue;
    out.push('', group.aisle.toUpperCase());
    for (const line of left(group.lines)) {
      out.push(`- ${line.name}: ${line.quantity}${line.brand ? `, ${line.brand}` : ''}${line.check ? ' (check the label)' : ''}`);
    }
  }
  if (list.seasonings.length) out.push('', `Seasonings the recipes use: ${list.seasonings.join(', ')}.`);
  return out.join('\n');
}
