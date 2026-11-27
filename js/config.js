// Settings that live in the repo rather than on your phone.
//
// The app and the calendar reminders both read meal times from here, so they
// always agree. After changing anything in this file, rebuild the reminders:
//
//     node tools/build-reminders.mjs
//
// then commit the new meal-reminders.ics and add it to your calendar again.

export const CONFIG = {
  appName: 'Fuel',

  // 24-hour clock, local time.
  mealTimes: {
    breakfast: '07:30',
    morningSnack: '10:00', // only used on days with a second snack (targets around 2,000 kcal and up)
    lunch: '12:00',
    snack: '15:30',
    dinner: '18:30',
  },

  reminders: {
    // The daily calorie target the calendar file is built for. It decides
    // which snack each day's reminder names. Match it to the target shown in
    // the app (Settings) if that changes.
    planKcal: 1800,
    // Last day the reminders repeat.
    until: '2027-03-31',
  },

  grocery: {
    // The price list the grocery screen pulls each time the app opens: stores,
    // what each ingredient is bought as, and typical prices. Edit that file to
    // change them, or point this at a price list kept somewhere else.
    priceList: './data/groceries.json',
  },
};
