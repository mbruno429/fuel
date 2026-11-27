// Settings that live in the repo rather than on your phone.
//
// These are starting points. Meal times can be changed in the app under
// Settings > Meal times, and the app rewrites the reminders file itself once
// it has a GitHub key (Settings > Meal reminders). Change them here only to
// change what a fresh install starts with; tools/build-reminders.mjs builds
// the reminders from these values.

export const CONFIG = {
  appName: 'Fuel',

  // 24-hour clock, local time. The times until changed in the app.
  mealTimes: {
    breakfast: '07:30',
    morningSnack: '10:00', // only used on days with a second snack (targets around 2,000 kcal and up)
    lunch: '12:00',
    snack: '15:30',
    dinner: '18:30',
  },

  reminders: {
    // For tools/build-reminders.mjs only: the calorie target it picks snacks
    // for, and the last day the reminders repeat. The app uses your own
    // target and goal date instead.
    planKcal: 1800,
    until: '2027-03-31',
  },

  grocery: {
    // The price list the grocery screen pulls each time the app opens: stores,
    // what each ingredient is bought as, and typical prices. Edit that file to
    // change them, or point this at a price list kept somewhere else.
    priceList: './data/groceries.json',
  },
};
