// The nut guard, in one place.
//
// The plan is kept free of peanuts and tree nuts. This list is what "a nut"
// means to the checks: the nuts themselves, plus a few foods that usually
// contain them (pesto, granola, trail mix). It matches whole words only, so
// "nonstick", "nutrition", "nutmeg" and "pineapple" do not trip it.
//
// Used by tools/check-plan.mjs, by the grocery price list checks, and by the
// app to warn when a product name you type mentions a nut.

export const NUT_WORDS = [
  'nut', 'nuts', 'peanut', 'peanuts', 'almond', 'almonds', 'walnut', 'walnuts', 'pecan', 'pecans',
  'cashew', 'cashews', 'pistachio', 'pistachios', 'hazelnut', 'hazelnuts', 'macadamia', 'brazil',
  'pine', 'praline', 'marzipan', 'nougat', 'pesto', 'satay', 'nutella', 'granola', 'trail',
];

const NUT_RE = new RegExp(`\\b(${NUT_WORDS.join('|')})\\b`, 'i');

/** The first nut word in a piece of text, lower-cased, or null if there is none. */
export function nutWordIn(text) {
  const hit = NUT_RE.exec(String(text ?? '').replace(/_/g, ' '));
  return hit ? hit[0].toLowerCase() : null;
}
