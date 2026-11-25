// Everything the app remembers lives in this one object, saved in the
// browser's localStorage on this device. Nothing is sent anywhere.

const KEY = 'fuel:v1';
const RECENT_LIMIT = 8;

function emptyState() {
  return { version: 1, settings: null, log: [], weights: [], swaps: {}, recent: [] };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
const listeners = new Set();

function write() {
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
    write();
  },
};
