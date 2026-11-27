# Fuel

A meal plan, meal reminders and a meal log in one small web app. It is a static site with no build step and no server: host the files on GitHub Pages, add the page to your iPhone's Home Screen, and it works offline. Everything you enter stays on your device.

What is in it:

- **Today** shows your calories and protein left, the day's meals at their times, and a box to tick when you eat each one. Anything off-plan goes in with "Log something else".
- **Plan** lists the next two weeks. Tap a meal for its recipe and nutrition, or to swap it for another. **Grocery list**, at the top of Plan, turns those meals into a shopping list with a budget.
- **Log** keeps every day since you started.
- **Progress** tracks your weight against the plan and, after two weeks of weigh-ins, tells you whether to change your calorie target.
- **Settings** is where you change everything: calories and protein, meal times, the meals themselves, the two-week menu, the meal reminders, grocery prices and stores, and backups. None of it needs a code edit.

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

A site on GitHub Pages has no server to push notifications from, and an iPhone will not let a web app schedule its own. So the reminders come from your Calendar: `meal-reminders.ics` on your site holds one repeating event per meal with an alert at the meal time. Each alert names the meal and shows on your iPhone and Apple Watch; the event's notes hold the ingredients and method.

The file has to live on the site, so when you change meal times, calories, meals or the menu, Fuel rewrites it in your repository for you. Set that up once:

1. In Fuel, open **Settings > Meal reminders** and tap **Connect to GitHub**.
2. Follow the link to GitHub's form for a new key. It arrives filled in with a name, 90 days and access to files. Under **Repository access**, choose **Only select repositories** and pick this repository. Tap **Generate token**, copy the key and paste it into Fuel.
3. Tap **Update the calendar file**. GitHub publishes it in about a minute.
4. Tap **Subscribe in Calendar** and confirm. Then, in the Settings app, go to **Apps > Calendar > Accounts > Subscribed Calendars**, open the new calendar and turn off **Remove Alarms**; otherwise the events arrive without alerts.

From then on, **Settings > Meal reminders** says when the file no longer matches your plan, and what changed. One tap updates it, and the subscribed calendar picks the change up the next time it refreshes, which can take a few hours.

About the key:

- It is a fine-grained personal access token. It can only read and write the files of the one repository you give it, and it expires (after 90 days, unless you choose otherwise). Fuel refuses classic tokens, which reach every repository you own.
- It is saved only in Fuel on that device, under its own storage name. It is never in the repository, never in a backup file, and only ever sent to `api.github.com`.
- Every update is an ordinary commit called "Update meal reminders from Fuel", so the repository history shows each change and GitHub can undo it.
- Every site you host at `YOUR-NAME.github.io` shares one address, so any of them could read Fuel's storage on that device. Remove the key in Fuel, and delete it on GitHub, when you stop using it.
- The calendar file is public, like the rest of the site. It names meals and times; it does not state your calorie target or anything else about you.

Without a key, the subscription still works but keeps whatever the file in the repository says. If you added the reminders by hand with the first version of Fuel, delete that Meals calendar so they do not show up twice.

The reminders follow the two-week menu. They do not know about a meal you swap for a single day, so treat the app as the final word.

### Building the file by hand

`node tools/build-reminders.mjs` builds the same file from the times in `js/config.js` and the built-in meals (needs Node 18 or newer, no packages; options `--from`, `--until` and `--kcal`). It does not know about changes made in the app, so once Fuel looks after the file, use the app: running the tool and pushing would put the original times and meals back.

## Grocery list

Open **Plan > Grocery list**. The app adds up the ingredients of your planned meals for the next 3, 7 or 14 days, turns them into things you buy, prices them, and compares the total with a budget if you set one.

- **Shopping at.** Pick the store. Ten chains are listed (Walmart, Target, Trader Joe's, Whole Foods, Raley's, Bel Air, Safeway, Costco, Sprouts, WinCo) and you can add your own, or hide the ones you do not use under **Settings > Stores**. The store decides which of your recorded prices apply, and which store brand the app points you to.
- **Budget for this trip.** What you want to spend. When the list comes to more, the app lists the changes that bring it under and makes them when you tap. Nothing changes until you do.
- **Brand.** Tap an item to choose a brand for it. "Lowest price" is the default. Switch on "Keep this brand" and the budget suggestions never touch it. Use that for a brand you buy because you have checked it is safe for you.
- **A price you paid.** Tap an item and enter the brand, package size and price. It is saved for the store you are shopping at and replaces the typical price there.
- **Typical prices.** To change the price used wherever you have not recorded one, open **Settings > Grocery prices**. Any item can go back to the price list's price.
- **Ticking off.** Tick items as they go in the cart. **Mark what I have** is for food already in your kitchen.
- **Each dinner feeds.** Multiplies dinner ingredients when you cook for more people. Breakfasts, lunches and snacks stay single portions.

### Where the prices come from

None of those stores offers a free price feed that a site like this can read, so the app cannot look their prices up. It starts from `data/groceries.json`, a list of typical prices: [U.S. Bureau of Labor Statistics average prices](https://www.bls.gov/regions/mid-atlantic/data/AverageRetailFoodAndEnergyPrices_USandWest_Table.htm) for October 2026 where one exists (West region, otherwise the U.S. city average), and estimates for everything else. Typical prices are the same for every store, so the app never says one store is cheaper than another on the strength of them. A typical price is marked with a `~` wherever it appears.

Each price you record replaces a typical one at that store, so the totals get exact as you use the list. Recorded prices, brand choices and purchases stay on your device and are part of the backup.

### The rules

The list is worked out by fixed rules in `js/grocery.js`. Nothing is random, nothing depends on the order things were entered, and no outside service is involved, so the same plan, prices, store, brands, purchases and budget always give the same list.

1. **Needs.** Every ingredient of every planned meal in the period, swaps included, minus meals already logged. Recipe grams become grams you buy: raw weight for cooked chicken, dry weight for cooked rice, whole cans for drained beans, bananas with the peel.
2. **Stock.** What you ticked or marked on earlier days comes off, less what the planned meals have used since. Food that keeps (pantry and frozen food, eggs, string cheese, parmesan) stays in stock until it is used up. Fresh food counts only for the days it was bought for. Marking something "at home" assumes one full package. An item ticked today stays on the list as "in the cart" and becomes stock tomorrow.
3. **Product.** With no brand chosen, the offer that covers the amount for the least money, in whole packages, or in quarter pounds for food sold by weight. A package may fall 5% short of the amount. Ties go to the lower unit price, then to a price you recorded, then alphabetically. With a brand chosen: that brand at this store's price, else its price at another store, else the typical price.
4. **Budget.** Over budget, cheaper brands are suggested first, largest saving first, skipping savings under 25 cents, brands marked "keep" and anything already ticked. If that is not enough, up to four meal changes follow: each is the single change that saves the most, worth at least a dollar, that keeps the day within 10 g of its protein and 100 kcal of its calories, never the same meal two days running or more than twice in the list. Meals already logged are left alone, and once you have started ticking items no meal change is suggested.

### Changing the price list

Typical prices and the stores shown can be changed in the app, under **Settings**; those changes stay on your device. `data/groceries.json` is the price list they start from: the stores, what each ingredient is bought as, and the typical prices. The app pulls it every time it opens, so an edit you push to GitHub shows up on the next launch. The note at the top of the file explains each field. To change a typical price, edit `price`; to add a store, add a line to `stores`. To keep the list somewhere else, point `grocery.priceList` in `js/config.js` at it.

If you add an ingredient to `js/foods.js`, add it to an item's `foods` in the price list too. `node tools/check-plan.mjs` fails when a meal uses something the price list does not buy.

### What it does not do

- It does not know any store's real prices or stock until you record them.
- It does not read packaging. "Check the label" marks kinds of packaged food that more often carry nut warnings, and a name you type that mentions a nut is flagged, but neither is a safety check.
- It does not know what you ate off-plan or what someone else took from the fridge. If the app thinks you have something you do not, tap it and choose **I have none left**.

## Changing the plan

All of this is changed in the app, under **Settings**:

- **Your plan**: daily calories and protein, starting and goal weight, goal date, BMR and Move calories. **Work out calories from these numbers** recalculates the target.
- **Meal times**: when each meal is. Today, the plan and the reminders follow them.
- **Meals**: change the amounts in any meal (the numbers update as you type), its name or its method; add meals of your own, from ingredients or from totals off a menu or label; keep a snack out of the automatic picks. Any built-in meal can be put back.
- **Two-week menu**: which breakfast, lunch and dinner fall on each day. **Swap** on the Plan tab can also change every other week instead of a single day.
- **Grocery prices** and **Stores**: see the grocery list section above.

Those changes are saved on your device and are part of a backup. They are laid over the built-in plan, which stays in the code as the starting point:

- `js/meals.js` holds the built-in meals: ingredients in grams, how to measure them, and the method. It also holds the original two-week rotation of breakfasts, lunches and dinners.
- `js/foods.js` holds nutrition per 100 g for each ingredient. Calories and macros are added up from it when the app loads, so changing an amount in a meal updates every number.
- Snacks are not in the rotation. Each day the app picks the snack that best fills the calories the three meals leave, working through the snack list in order. At targets of roughly 2,000 kcal and up it adds a morning snack.

After editing, run the checks:

```
node tools/check-plan.mjs        # every meal, every day and the grocery price list against the plan's limits
node tools/check-plan.mjs 1600   # the same at another calorie target
node --test                      # the logic tests
```

**Allergens.** The plan contains no peanuts or tree nuts, and both the check script and the tests fail if a nut appears in a food, an ingredient line, a meal name, a method or the grocery price list. The list of words that count as a nut is in `js/allergens.js`. In the app, a meal you name or describe with one of those words gets a warning, and saving it takes a second tap. The hummus and the sesame oil contain sesame, and a few recipes use chia seeds. Packaged foods can carry nut warnings whatever the recipe says, so read the labels on protein powder, oats, bread, tortillas, hummus, seasoning mixes and sauces.

## How the numbers are worked out

- **Daily burn.** With a watch average: BMR + average Move calories + the energy to digest food (about 10% of what you eat). Without one: BMR × 1.55, the usual figure for a moderately active person.
- **Deficit.** The pounds to lose × 3,500 kcal, spread over the days left, capped at 1,100 kcal a day (a little over 2 lb a week).
- **Calorie target.** Burn minus deficit, rounded to the nearest 50, never below 1,500.
- **Protein target.** 1.6 g per kg of goal weight (0.73 g per lb).
- **Pace check.** Once there are three weigh-ins across two weeks, the app fits a line through the last four weeks of weigh-ins and compares it with the pace your goal needs. If you are more than about a third of a pound a week behind, it suggests 100 to 250 fewer calories, never below 1,500. If you are losing faster than 1% of your body weight a week and well ahead of pace, it suggests more. It waits two weeks after every change.

All of this is estimation. Watch calorie counts and food labels are both rough, which is why the weigh-ins get the last word. The app is a planning aid, not medical advice.

## Your data

Your settings, log, weigh-ins, meal changes and grocery choices are saved in the browser's storage on your device and nowhere else. The one thing that leaves it is the reminders file, which Fuel writes to your repository if you connect a GitHub key (see Meal reminders); the key itself stays on the device. **Settings > Backup** saves everything except the key to a file and restores it. Make a backup now and then, and before deleting the app from your Home Screen, because that deletes its data.

## Files

```
index.html              the page
css/app.css             styles
js/app.js               screens and taps
js/core.js              dates, targets, meal times, the daily plan, pace check, calendar file
js/grocery.js           the grocery list: needs, stock, products, budget
js/publish.js           writing the reminders file to GitHub
js/allergens.js         the words the nut checks look for
js/store.js             saving and loading on the device
js/chart.js             the weight chart
js/meals.js             built-in meals and rotation, with your changes laid over them
js/foods.js             nutrition per 100 g, and each food's name on screen
js/config.js            the original meal times, reminder settings, where the price list is
data/groceries.json     stores, what each ingredient is bought as, typical prices
sw.js                   offline support
manifest.webmanifest    Home Screen name and icons
meal-reminders.ics      the calendar reminders
tools/                  build-reminders.mjs and check-plan.mjs
tests/                  logic tests
fonts/                  Archivo Black, under the SIL Open Font License (see fonts/OFL.txt)
```
