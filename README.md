# Fuel

A meal plan, meal reminders and a meal log in one small web app. It is a static site with no build step and no server: host the files on GitHub Pages, add the page to your iPhone's Home Screen, and it works offline. Everything you enter stays on your device.

What is in it:

- **Today** shows your calories and protein left, the day's meals at their times, and a box to tick when you eat each one. Anything off-plan goes in with "Log something else".
- **Plan** lists the next two weeks. Tap a meal for its recipe and nutrition, or to swap it for another.
- **Log** keeps every day since you started.
- **Progress** tracks your weight against the plan and, after two weeks of weigh-ins, tells you whether to change your calorie target.
- **Settings** holds your numbers, the meal reminders and backups.

## Put it on GitHub Pages

1. Create a new repository on GitHub. On the free plan it must be public for Pages to work. Nothing personal is in these files; your weight and log never leave your phone.
2. Add every file and folder from this project to the repository, keeping the folder layout (`index.html` at the top level). On github.com that is **Add file > Upload files**, then drag the contents of this folder in. With git:

   ```
   git init
   git add .
   git commit -m "Fuel"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   git push -u origin main
   ```

3. In the repository, open **Settings > Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose the `main` branch and the `/ (root)` folder, and save.
4. After a minute or two the app is live at `https://YOUR-NAME.github.io/YOUR-REPO/`.

All paths in the app are relative, so any repository name works. The empty `.nojekyll` file tells Pages to publish the files as they are; if it gets left out of an upload the site still works.

## Install it on your iPhone

1. Open the address in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Fuel from the new icon and enter your numbers there, not in Safari. The Home Screen app keeps its own data, separate from Safari's.

On first launch it asks for your weight, goal weight, goal date and BMR, plus your Apple Watch's average Move calories if you know it (in the Fitness app, Summary shows the average under Trends).

## Meal reminders

A site on GitHub Pages has no server to push notifications from, and an iPhone will not let a web app schedule its own. So the reminders come from your Calendar: `meal-reminders.ics` holds one repeating event per meal with an alert at the meal time. Each alert names the meal and shows on your iPhone and Apple Watch; the event's notes hold the ingredients and method.

To add them:

1. In the Calendar app, create a calendar named Meals. Keeping the reminders in their own calendar means you can remove them all at once by deleting that calendar.
2. In Fuel, open **Settings > Meal reminders** and tap **Add reminders to Calendar**. Tap **Add All** and choose the Meals calendar.
3. If the button does nothing inside the Home Screen app, open the address shown under it in Safari. Opening the file on a Mac signed in to the same iCloud account works too.

The reminders follow the same two-week rotation the app shows. They do not know about meals you swap on a given day, so treat the app as the final word.

### Changing meal times, or rebuilding the reminders

Meal times live in `js/config.js`, which the app and the reminders both read. After changing them, or after changing meals, rebuild the calendar file (needs Node 18 or newer, no packages):

```
node tools/build-reminders.mjs
```

Options: `--from 2026-12-01` for the first day, `--until 2027-03-31` for the last, `--kcal 1700` to pick snacks for a different calorie target. Commit the new file, delete the old Meals calendar on your phone, and add the reminders again.

If your calorie target in the app changes, set `planKcal` in `js/config.js` to match and rebuild; until then some snack reminders will name a different snack than the app.

### Subscribing instead (not tested on a device)

Calendar can also subscribe to the file, which gives the reminders their own calendar and picks up changes whenever you push a new `meal-reminders.ics`: open `webcal://YOUR-NAME.github.io/YOUR-REPO/meal-reminders.ics` in Safari. iPhones can strip alerts from subscribed calendars, so check the subscription's settings (Settings, Calendar, Accounts, Subscribed Calendars) and make sure **Remove Alarms** is off.

## Changing the plan

- `js/meals.js` holds every meal: ingredients in grams, how to measure them, and the method. It also holds the two-week rotation of breakfasts, lunches and dinners.
- `js/foods.js` holds nutrition per 100 g for each ingredient. Calories and macros are added up from it when the app loads, so changing an amount in a meal updates every number.
- Snacks are not in the rotation. Each day the app picks the snack that best fills the calories the three meals leave, working through the snack list in order. At targets of roughly 2,000 kcal and up it adds a morning snack.

After editing, run the checks:

```
node tools/check-plan.mjs        # every meal and every day against the plan's limits
node tools/check-plan.mjs 1600   # the same at another calorie target
node --test                      # the logic tests
```

**Allergens.** The plan contains no peanuts or tree nuts, and both the check script and the tests fail if a nut appears in a food, an ingredient line, a meal name or a method. The hummus and the sesame oil contain sesame, and a few recipes use chia seeds. Packaged foods can carry nut warnings whatever the recipe says, so read the labels on protein powder, oats, bread, tortillas, hummus, seasoning mixes and sauces.

## How the numbers are worked out

- **Daily burn.** With a watch average: BMR + average Move calories + the energy to digest food (about 10% of what you eat). Without one: BMR × 1.55, the usual figure for a moderately active person.
- **Deficit.** The pounds to lose × 3,500 kcal, spread over the days left, capped at 1,100 kcal a day (a little over 2 lb a week).
- **Calorie target.** Burn minus deficit, rounded to the nearest 50, never below 1,500.
- **Protein target.** 1.6 g per kg of goal weight (0.73 g per lb).
- **Pace check.** Once there are three weigh-ins across two weeks, the app fits a line through the last four weeks of weigh-ins and compares it with the pace your goal needs. If you are more than about a third of a pound a week behind, it suggests 100 to 250 fewer calories, never below 1,500. If you are losing faster than 1% of your body weight a week and well ahead of pace, it suggests more. It waits two weeks after every change.

All of this is estimation. Watch calorie counts and food labels are both rough, which is why the weigh-ins get the last word. The app is a planning aid, not medical advice.

## Your data

Your settings, log and weigh-ins are saved in the browser's storage on your device and nowhere else. **Settings > Backup** saves everything to a file and restores it. Make a backup now and then, and before deleting the app from your Home Screen, because that deletes its data.

## Files

```
index.html              the page
css/app.css             styles
js/app.js               screens and taps
js/core.js              dates, targets, the daily plan, pace check, calendar file
js/store.js             saving and loading on the device
js/chart.js             the weight chart
js/meals.js             meals and the two-week rotation
js/foods.js             nutrition per 100 g
js/config.js            meal times and reminder settings
sw.js                   offline support
manifest.webmanifest    Home Screen name and icons
meal-reminders.ics      the calendar reminders
tools/                  build-reminders.mjs and check-plan.mjs
tests/                  logic tests
fonts/                  Archivo Black, under the SIL Open Font License (see fonts/OFL.txt)
```
