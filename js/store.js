// Everything the app remembers lives in this one object, saved in the
// browser's localStorage on this device. Nothing is sent anywhere.
//
// The one exception is the GitHub key for updating the reminders file. It is
// kept under its own name (see keyStore below), so it is never part of a
// backup, and it is only ever sent to api.github.com.

import { CONFIG } from './config.js';
import { FOODS } from './foods.js';
import { BASE_MEALS, MAIN_SLOTS, METHOD_MAX, NAME_MAX, SLOTS, cleanFacts, cleanItems } from './meals.js';

const KEY = 'fuel:v1';
const GITHUB_KEY = 'fuel:github';
const RECENT_LIMIT = 8;
const GROCERY_DAYS = [3, 7, 14];
const PRICE_LIMIT = 500;
const LOT_LIMIT = 600;
const STORE_LIMIT = 20;

const ADDED_LIMIT = 100;
const SLOT_KEYS = ['breakfast', 'morningSnack', 'lunch', 'snack', 'dinner'];

/** Grocery choices: where you shop, your budget, brands, prices you paid and what you bought. */
function emptyGrocery() {
  return { store: null, days: 7, budget: null, servings: 1, prefs: {}, offers: [], lots: [], stores: [], typical: {}, hidden: [] };
}

/** Changes to the plan made in the app: meal times, meals and the two-week menu. */
function emptyCustom() {
  return { times: { ...CONFIG.mealTimes }, meals: { edits: {}, added: [], auto: {} }, menu: {} };
}

function emptyState() {
  return {
    version: 1,
    settings: null,
    log: [],
    weights: [],
    swaps: {},
    recent: [],
    grocery: emptyGrocery(),
    custom: emptyCustom(),
    reminders: { published: null },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const cleanLines = (value, max) => (typeof value === 'string' ? value.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '');
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const BASE_IDS = new Set(BASE_MEALS.map((meal) => meal.id));

/** A changed built-in meal: only the parts that were changed are kept. */
function normalizeEdit(raw) {
  if (!isPlainObject(raw)) return null;
  const edit = {};
  const name = cleanText(raw.name, NAME_MAX);
  if (name) edit.name = name;
  if (raw.items !== undefined) {
    const items = cleanItems(raw.items);
    if (items.length) edit.items = items;
  }
  if (typeof raw.method === 'string') edit.method = cleanLines(raw.method, METHOD_MAX);
  return Object.keys(edit).length ? edit : null;
}

/** A meal of your own, or null if it does not hold together. */
function normalizeAdded(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !/^my-[a-z0-9-]{1,60}$/.test(raw.id)) return null;
  const name = cleanText(raw.name, NAME_MAX);
  if (!name || !SLOTS.includes(raw.slot)) return null;
  const items = cleanItems(raw.items);
  const facts = items.length ? null : cleanFacts(raw.facts);
  if (!items.length && !facts) return null;
  const meal = { id: raw.id, slot: raw.slot, name, items, method: cleanLines(raw.method, METHOD_MAX) };
  if (facts) meal.facts = facts;
  if (Number(raw.mins) > 0 && Number(raw.mins) <= 600) meal.mins = Math.round(Number(raw.mins));
  return meal;
}

function normalizeCustom(raw) {
  const custom = emptyCustom();
  if (!isPlainObject(raw)) return custom;
  if (isPlainObject(raw.times)) {
    for (const slot of SLOT_KEYS) if (isTime(raw.times[slot])) custom.times[slot] = raw.times[slot];
  }
  const meals = isPlainObject(raw.meals) ? raw.meals : {};
  if (isPlainObject(meals.edits)) {
    for (const [id, value] of Object.entries(meals.edits)) {
      const edit = BASE_IDS.has(id) ? normalizeEdit(value) : null;
      if (edit) custom.meals.edits[id] = edit;
    }
  }
  const seen = new Set();
  for (const value of Array.isArray(meals.added) ? meals.added : []) {
    const meal = normalizeAdded(value);
    if (!meal || seen.has(meal.id) || custom.meals.added.length >= ADDED_LIMIT) continue;
    seen.add(meal.id);
    custom.meals.added.push(meal);
  }
  if (isPlainObject(meals.auto)) {
    for (const [id, on] of Object.entries(meals.auto)) {
      if (typeof on === 'boolean' && (BASE_IDS.has(id) || seen.has(id))) custom.meals.auto[id] = on;
    }
  }
  if (isPlainObject(raw.menu)) {
    for (const [index, day] of Object.entries(raw.menu)) {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i > 13 || !isPlainObject(day)) continue;
      const clean = {};
      for (const slot of MAIN_SLOTS) {
        if (typeof day[slot] === 'string' && (BASE_IDS.has(day[slot]) || seen.has(day[slot]))) clean[slot] = day[slot];
      }
      if (Object.keys(clean).length) custom.menu[i] = clean;
    }
  }
  return custom;
}

function normalizeReminders(raw) {
  const p = isPlainObject(raw) ? raw.published : null;
  if (!isPlainObject(p) || typeof p.signature !== 'string' || typeof p.at !== 'string') return { published: null };
  const times = {};
  for (const slot of SLOT_KEYS) times[slot] = isTime(p.times && p.times[slot]) ? p.times[slot] : CONFIG.mealTimes[slot];
  return {
    published: {
      at: p.at,
      signature: p.signature.slice(0, 80),
      kcal: Number.isFinite(Number(p.kcal)) ? Number(p.kcal) : null,
      until: isDate(p.until) ? p.until : null,
      times,
      commit: typeof p.commit === 'string' ? p.commit.slice(0, 64) : null,
    },
  };
}

function normalizeGrocery(raw) {
  const grocery = emptyGrocery();
  if (!isPlainObject(raw)) return grocery;
  grocery.store = cleanText(raw.store, 40) || null;
  if (GROCERY_DAYS.includes(Number(raw.days))) grocery.days = Number(raw.days);
  const budget = Number(raw.budget);
  if (raw.budget !== null && Number.isFinite(budget) && budget > 0 && budget <= 100000) grocery.budget = Math.round(budget * 100) / 100;
  const servings = Math.round(Number(raw.servings));
  if (servings >= 1 && servings <= 6) grocery.servings = servings;

  if (isPlainObject(raw.prefs)) {
    for (const [item, pref] of Object.entries(raw.prefs)) {
      const brand = isPlainObject(pref) ? cleanText(pref.brand, 60) : '';
      if (brand) grocery.prefs[item] = { brand, keep: pref.keep === true };
    }
  }
  if (Array.isArray(raw.offers)) {
    grocery.offers = raw.offers
      .filter((o) => isPlainObject(o) && cleanText(o.item, 40) && cleanText(o.store, 40) && cleanText(o.unit, 10) && Number(o.price) > 0)
      .slice(-PRICE_LIMIT)
      .map((o) => ({
        id: String(o.id || newId()),
        item: cleanText(o.item, 40),
        store: cleanText(o.store, 40),
        brand: cleanText(o.brand, 60),
        unit: cleanText(o.unit, 10),
        size: Number(o.size) > 0 ? Number(o.size) : 1,
        price: Math.round(Number(o.price) * 100) / 100,
        date: isDate(o.date) ? o.date : null,
      }));
  }
  if (Array.isArray(raw.lots)) {
    grocery.lots = raw.lots
      .filter((l) => isPlainObject(l) && cleanText(l.item, 40) && isDate(l.date) && Number(l.grams) > 0)
      .slice(-LOT_LIMIT)
      .map((l) => ({
        id: String(l.id || newId()),
        item: cleanText(l.item, 40),
        date: l.date,
        grams: Number(l.grams),
        until: isDate(l.until) ? l.until : null,
        home: l.home === true,
        skip: Array.isArray(l.skip) ? l.skip.filter((slot) => typeof slot === 'string').slice(0, 5) : [],
      }));
  }
  if (isPlainObject(raw.typical)) {
    for (const [item, price] of Object.entries(raw.typical)) {
      if (!isPlainObject(price) || !cleanText(price.unit, 10) || !(Number(price.price) > 0) || Number(price.price) > 1000) continue;
      grocery.typical[cleanText(item, 40)] = {
        unit: cleanText(price.unit, 10),
        size: Number(price.size) > 0 ? Number(price.size) : 1,
        price: Math.round(Number(price.price) * 100) / 100,
      };
    }
  }
  if (Array.isArray(raw.hidden)) {
    grocery.hidden = [...new Set(raw.hidden.filter((id) => typeof id === 'string').map((id) => cleanText(id, 40)))].slice(0, 50);
  }
  if (Array.isArray(raw.stores)) {
    const seen = new Set();
    for (const s of raw.stores) {
      const id = isPlainObject(s) ? cleanText(s.id, 40) : '';
      const name = isPlainObject(s) ? cleanText(s.name, 40) : '';
      if (!id || !name || seen.has(id) || grocery.stores.length >= STORE_LIMIT) continue;
      seen.add(id);
      grocery.stores.push({ id, name, brand: cleanText(s.brand, 40) });
    }
  }
  return grocery;
}

/** Accept only the shape we know, so a bad import cannot break the app. */
export function normalizeState(raw) {
  const state = emptyState();
  if (!isPlainObject(raw)) return state;
  if (isPlainObject(raw.settings)) {
    const s = raw.settings;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const settings = {
      bmr: num(s.bmr),
      startWeight: num(s.startWeight),
      goalWeight: num(s.goalWeight),
      startDate: typeof s.startDate === 'string' ? s.startDate : null,
      targetDate: typeof s.targetDate === 'string' ? s.targetDate : null,
      activeKcal: s.activeKcal ? num(s.activeKcal) : null,
      kcalTarget: num(s.kcalTarget),
      proteinTarget: num(s.proteinTarget),
      targetChangedOn: typeof s.targetChangedOn === 'string' ? s.targetChangedOn : null,
    };
    const required = ['bmr', 'startWeight', 'goalWeight', 'startDate', 'targetDate', 'kcalTarget', 'proteinTarget'];
    if (required.every((key) => settings[key] !== null)) {
      // Every target that has applied, oldest first, so past days keep theirs.
      const history = (Array.isArray(s.targets) ? s.targets : [])
        .filter((t) => isPlainObject(t) && typeof t.from === 'string' && num(t.kcal) !== null && num(t.protein) !== null)
        .map((t) => ({ from: t.from, kcal: num(t.kcal), protein: num(t.protein) }))
        .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
      settings.targets = history.length
        ? history
        : [{ from: settings.startDate, kcal: settings.kcalTarget, protein: settings.proteinTarget }];
      state.settings = settings;
    }
  }
  if (Array.isArray(raw.log)) {
    state.log = raw.log
      .filter((e) => isPlainObject(e) && typeof e.date === 'string' && Number.isFinite(Number(e.kcal)))
      .map((e) => ({
        id: String(e.id || newId()),
        date: e.date,
        slot: typeof e.slot === 'string' ? e.slot : 'other',
        mealId: typeof e.mealId === 'string' ? e.mealId : null,
        name: String(e.name || 'Food').slice(0, 120),
        kcal: Math.max(0, Math.round(Number(e.kcal))),
        protein: Math.max(0, Math.round(Number(e.protein) || 0)),
        at: typeof e.at === 'string' ? e.at : null,
      }));
  }
  if (Array.isArray(raw.weights)) {
    const byDate = new Map();
    for (const w of raw.weights) {
      if (isPlainObject(w) && typeof w.date === 'string' && Number(w.lb) > 0) byDate.set(w.date, Number(w.lb));
    }
    state.weights = [...byDate].map(([date, lb]) => ({ date, lb })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  if (isPlainObject(raw.swaps)) {
    for (const [date, slots] of Object.entries(raw.swaps)) {
      if (!isPlainObject(slots)) continue;
      const clean = {};
      for (const [slot, id] of Object.entries(slots)) if (typeof id === 'string') clean[slot] = id;
      if (Object.keys(clean).length) state.swaps[date] = clean;
    }
  }
  if (Array.isArray(raw.recent)) {
    state.recent = raw.recent
      .filter((r) => isPlainObject(r) && r.name && Number.isFinite(Number(r.kcal)))
      .slice(0, RECENT_LIMIT)
      .map((r) => ({ name: String(r.name).slice(0, 120), kcal: Math.round(Number(r.kcal)), protein: Math.round(Number(r.protein) || 0) }));
  }
  state.grocery = normalizeGrocery(raw.grocery);
  state.custom = normalizeCustom(raw.custom);
  state.reminders = normalizeReminders(raw.reminders);
  return state;
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function read() {
  try {
    const text = localStorage.getItem(KEY);
    return text ? normalizeState(JSON.parse(text)) : emptyState();
  } catch {
    return emptyState();
  }
}

let state = read();
let saveFailed = false;
let batching = false;
let changedInBatch = false;
const listeners = new Set();

function write() {
  if (batching) {
    changedInBatch = true;
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    saveFailed = true; // private browsing or storage full
  }
  for (const fn of listeners) fn(state);
}

export const store = {
  get state() {
    return state;
  },
  get saveFailed() {
    return saveFailed;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Returns false, and keeps the old settings, if the new ones are incomplete. */
  saveSettings(settings) {
    const clean = normalizeState({ settings }).settings;
    if (!clean) return false;
    state.settings = clean;
    write();
    return true;
  },

  /** Record a weigh-in; one per date, the newest value wins. */
  setWeight(date, lb) {
    state.weights = state.weights.filter((w) => w.date !== date);
    state.weights.push({ date, lb: Math.round(lb * 10) / 10 });
    state.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
    write();
  },
  removeWeight(date) {
    state.weights = state.weights.filter((w) => w.date !== date);
    write();
  },

  addEntry(entry) {
    const saved = {
      id: newId(),
      date: entry.date,
      slot: entry.slot || 'other',
      mealId: entry.mealId || null,
      name: String(entry.name).trim().slice(0, 120),
      kcal: Math.max(0, Math.round(Number(entry.kcal))),
      protein: Math.max(0, Math.round(Number(entry.protein) || 0)),
      at: new Date().toISOString(),
    };
    state.log.push(saved);
    if (saved.slot === 'other') {
      const key = saved.name.toLowerCase();
      state.recent = [
        { name: saved.name, kcal: saved.kcal, protein: saved.protein },
        ...state.recent.filter((r) => r.name.toLowerCase() !== key),
      ].slice(0, RECENT_LIMIT);
    }
    write();
    return saved;
  },
  removeEntry(id) {
    state.log = state.log.filter((e) => e.id !== id);
    write();
  },
  entriesFor(date) {
    return state.log.filter((e) => e.date === date);
  },

  /** Swap one slot on one date. Pass null to go back to the planned meal. */
  setSwap(date, slot, mealId) {
    const day = { ...(state.swaps[date] || {}) };
    if (mealId) day[slot] = mealId;
    else delete day[slot];
    if (Object.keys(day).length) state.swaps[date] = day;
    else delete state.swaps[date];
    write();
  },

  /** Make several changes and save (and redraw) once at the end. */
  batch(fn) {
    batching = true;
    changedInBatch = false;
    try {
      fn();
    } finally {
      batching = false;
    }
    if (changedInBatch) write();
  },

  // ---- groceries

  /** Change the store, the number of days, the budget or the dinner servings. */
  setGrocery(patch) {
    state.grocery = normalizeGrocery({ ...state.grocery, ...patch });
    write();
  },
  /** Choose a brand for an item. Pass null to go back to the lowest price. */
  setGroceryPref(item, pref) {
    const prefs = { ...state.grocery.prefs };
    const brand = pref ? cleanText(pref.brand, 60) : '';
    if (brand) prefs[item] = { brand, keep: pref.keep === true };
    else delete prefs[item];
    state.grocery.prefs = prefs;
    write();
  },
  /** Record what a product costs at a store. One price per store, brand and size: the newest wins. */
  addGroceryPrice(price) {
    const saved = normalizeGrocery({ offers: [{ ...price, id: newId() }] }).offers[0];
    if (!saved) return null;
    const same = (o) => o.item === saved.item && o.store === saved.store && o.unit === saved.unit && o.size === saved.size
      && o.brand.toLowerCase() === saved.brand.toLowerCase();
    state.grocery.offers = [...state.grocery.offers.filter((o) => !same(o)), saved].slice(-PRICE_LIMIT);
    write();
    return saved;
  },
  removeGroceryPrice(id) {
    state.grocery.offers = state.grocery.offers.filter((o) => o.id !== id);
    write();
  },
  /**
   * Record that an item was bought (ticked in the store) or is already at
   * home. One record per item, day and kind. Fresh food past its days is
   * cleared out at the same time.
   */
  addGroceryLot(lot, today) {
    const saved = normalizeGrocery({ lots: [{ ...lot, id: newId() }] }).lots[0];
    if (!saved) return null;
    state.grocery.lots = [
      ...state.grocery.lots.filter((l) => !(l.item === saved.item && l.date === saved.date && l.home === saved.home) && !(l.until && l.until < today)),
      saved,
    ].slice(-LOT_LIMIT);
    write();
    return saved;
  },
  /** Forget purchases. `match` gets each record and returns true to forget it. */
  removeGroceryLots(match) {
    state.grocery.lots = state.grocery.lots.filter((l) => !match(l));
    write();
  },
  /** Add a store of your own. Returns its id. */
  addGroceryStore({ name, brand }) {
    const clean = cleanText(name, 40);
    if (!clean || state.grocery.stores.length >= STORE_LIMIT) return null;
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
    let id = `my-${slug}`;
    for (let n = 2; state.grocery.stores.some((s) => s.id === id); n += 1) id = `my-${slug}-${n}`;
    state.grocery.stores = [...state.grocery.stores, { id, name: clean, brand: cleanText(brand, 40) }];
    state.grocery.store = id;
    write();
    return id;
  },
  /** Remove a store you added, with the prices recorded there. */
  removeGroceryStore(id) {
    state.grocery.stores = state.grocery.stores.filter((s) => s.id !== id);
    state.grocery.offers = state.grocery.offers.filter((o) => o.store !== id);
    if (state.grocery.store === id) state.grocery.store = null;
    write();
  },

  // ---- meal times, meals and the two-week menu

  /** Change some meal times. Malformed times are ignored. */
  setMealTimes(times) {
    state.custom = normalizeCustom({ ...state.custom, times: { ...state.custom.times, ...times } });
    write();
  },
  /**
   * Save a meal. For a built-in meal this stores your version of it; for one
   * of yours it replaces it. Returns the meal's id, or null if it did not save.
   */
  saveMeal(id, meal) {
    const meals = { ...state.custom.meals, edits: { ...state.custom.meals.edits }, added: [...state.custom.meals.added] };
    if (BASE_IDS.has(id)) {
      const edit = normalizeEdit(meal);
      if (!edit) return null;
      meals.edits[id] = edit;
    } else {
      const index = meals.added.findIndex((m) => m.id === id);
      const saved = normalizeAdded({ ...meal, id, slot: index >= 0 ? meals.added[index].slot : meal.slot });
      if (!saved || index < 0) return null;
      meals.added[index] = saved;
    }
    state.custom = normalizeCustom({ ...state.custom, meals });
    write();
    return id;
  },
  /** Add a meal of your own. Returns its new id, or null if it did not save. */
  addMeal(meal) {
    if (state.custom.meals.added.length >= ADDED_LIMIT) return null;
    const slug = cleanText(meal.name, NAME_MAX).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'meal';
    let id = `my-${slug}`;
    const taken = new Set(state.custom.meals.added.map((m) => m.id));
    for (let n = 2; taken.has(id); n += 1) id = `my-${slug}-${n}`;
    const saved = normalizeAdded({ ...meal, id });
    if (!saved) return null;
    state.custom = normalizeCustom({ ...state.custom, meals: { ...state.custom.meals, added: [...state.custom.meals.added, saved] } });
    write();
    return id;
  },
  /** Put a built-in meal back the way it came. */
  resetMeal(id) {
    const edits = { ...state.custom.meals.edits };
    delete edits[id];
    state.custom = { ...state.custom, meals: { ...state.custom.meals, edits } };
    write();
  },
  /** Delete a meal of your own, and take it out of the menu and any swaps. */
  deleteMeal(id) {
    const meals = state.custom.meals;
    const auto = { ...meals.auto };
    delete auto[id];
    const menu = {};
    for (const [index, day] of Object.entries(state.custom.menu)) {
      const clean = Object.fromEntries(Object.entries(day).filter(([, mealId]) => mealId !== id));
      if (Object.keys(clean).length) menu[index] = clean;
    }
    for (const [date, slots] of Object.entries(state.swaps)) {
      const clean = Object.fromEntries(Object.entries(slots).filter(([, mealId]) => mealId !== id));
      if (Object.keys(clean).length) state.swaps[date] = clean;
      else delete state.swaps[date];
    }
    state.custom = { ...state.custom, meals: { ...meals, added: meals.added.filter((m) => m.id !== id), auto }, menu };
    write();
  },
  /** Let the plan pick a snack by itself, or not. */
  setSnackAuto(id, on) {
    state.custom = normalizeCustom({ ...state.custom, meals: { ...state.custom.meals, auto: { ...state.custom.meals.auto, [id]: Boolean(on) } } });
    write();
  },
  /** Put a meal in one cell of the two-week menu. Pass null to go back to the original. */
  setMenu(index, slot, mealId) {
    const menu = { ...state.custom.menu };
    const day = { ...(menu[index] || {}) };
    if (mealId) day[slot] = mealId;
    else delete day[slot];
    if (Object.keys(day).length) menu[index] = day;
    else delete menu[index];
    state.custom = normalizeCustom({ ...state.custom, menu });
    write();
  },
  resetMenu() {
    state.custom = { ...state.custom, menu: {} };
    write();
  },

  // ---- grocery prices and stores

  /** Set the typical price of an item on this device. Pass null to use the price list's again. */
  setTypicalPrice(item, price) {
    const typical = { ...state.grocery.typical };
    if (price) typical[item] = price;
    else delete typical[item];
    state.grocery = normalizeGrocery({ ...state.grocery, typical });
    write();
  },
  /** Show or hide a store in the "Shopping at" list. */
  setStoreHidden(id, hidden) {
    const set = new Set(state.grocery.hidden);
    if (hidden) set.add(id);
    else set.delete(id);
    state.grocery = normalizeGrocery({ ...state.grocery, hidden: [...set] });
    write();
  },

  // ---- reminders

  /** Remember what the reminders file on the site was last made from. */
  setPublished(published) {
    state.reminders = normalizeReminders({ published });
    write();
  },

  exportJSON() {
    return JSON.stringify({ app: 'fuel', exportedAt: new Date().toISOString(), ...state }, null, 2);
  },
  /** Replace everything with a backup. Returns false if the file is not one of ours. */
  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
    if (!isPlainObject(parsed) || parsed.app !== 'fuel') return false;
    state = normalizeState(parsed);
    write();
    return true;
  },
  reset() {
    state = emptyState();
    keyStore.clear();
    write();
  },
};

// ---------------------------------------------------------------- the GitHub key
// Kept apart from everything else so that it never ends up in a backup file.

function readKey() {
  try {
    const raw = JSON.parse(localStorage.getItem(GITHUB_KEY) || 'null');
    if (!isPlainObject(raw) || typeof raw.token !== 'string' || !raw.token) return null;
    return {
      token: raw.token,
      owner: cleanText(raw.owner, 100),
      repo: cleanText(raw.repo, 100),
      path: cleanText(raw.path, 200) || 'meal-reminders.ics',
    };
  } catch {
    return null;
  }
}

export const keyStore = {
  get() {
    return readKey();
  },
  /** Returns false if the browser would not save it. */
  set({ token, owner, repo, path }) {
    try {
      localStorage.setItem(GITHUB_KEY, JSON.stringify({ token: String(token).trim(), owner, repo, path }));
      return true;
    } catch {
      return false;
    }
  },
  clear() {
    try {
      localStorage.removeItem(GITHUB_KEY);
    } catch {
      // nothing to do
    }
  },
};
