// The meal library and the two-week rotation.
//
// Each meal lists its ingredients as [food id, grams, how to measure it].
// Calories and macros are worked out from js/foods.js when the app loads,
// so changing an amount here updates every number in the app.
//
// The plan contains no peanuts or tree nuts. Keep it that way: after any
// edit run  node tools/check-plan.mjs  which fails if one appears in a food
// id, an ingredient line, a meal name or a method.

import { FOODS } from './foods.js';

const RAW_MEALS = [
  // ---------- Breakfasts (about 400 kcal) ----------
  {
    id: 'b-oats', slot: 'breakfast', name: 'Protein overnight oats', mins: 5,
    items: [
      ['oats', 40, '½ cup rolled oats'],
      ['whey', 30, '1 scoop whey protein'],
      ['milk_1', 183, '¾ cup 1% milk'],
      ['chia', 4, '1 tsp chia seeds'],
      ['banana', 60, '½ medium banana, sliced'],
    ],
    method: 'Stir the oats, protein powder, milk and chia together in a jar. Refrigerate overnight. Top with the banana.',
  },
  {
    id: 'b-scramble', slot: 'breakfast', name: 'Veggie egg scramble with toast', mins: 10,
    items: [
      ['egg', 100, '2 large eggs'],
      ['egg_whites', 160, '⅔ cup liquid egg whites'],
      ['spinach', 60, '2 cups spinach'],
      ['bell_pepper', 50, '⅓ bell pepper, diced'],
      ['olive_oil', 4.5, '1 tsp olive oil'],
      ['bread_ww', 32, '1 slice whole-wheat toast'],
      ['strawberries', 100, '⅔ cup strawberries'],
    ],
    method: 'Soften the pepper in the oil, wilt the spinach, then scramble in the eggs and whites. Serve with the toast and berries.',
  },
  {
    id: 'b-yogurt', slot: 'breakfast', name: 'Greek yogurt power bowl', mins: 3,
    items: [
      ['greek_yogurt', 245, '1 cup nonfat plain Greek yogurt'],
      ['blueberries', 100, '⅔ cup blueberries'],
      ['oats', 27, '⅓ cup rolled oats'],
      ['chia', 12, '1 tbsp chia seeds'],
      ['honey', 7, '1 tsp honey'],
    ],
    method: 'Stir the oats and chia into the yogurt and top with the berries and honey.',
  },
  {
    id: 'b-shake', slot: 'breakfast', name: 'Banana oat protein shake', mins: 3,
    items: [
      ['whey', 30, '1 scoop whey protein'],
      ['banana', 118, '1 medium banana'],
      ['oats', 20, '¼ cup rolled oats'],
      ['milk_1', 183, '¾ cup 1% milk'],
      ['spinach', 30, '1 cup spinach'],
    ],
    method: 'Blend with a cup of ice until smooth.',
  },
  {
    id: 'b-cottage', slot: 'breakfast', name: 'Cottage cheese and berries with egg on toast', mins: 8,
    items: [
      ['cottage_cheese', 226, '1 cup 2% cottage cheese'],
      ['strawberries', 150, '1 cup strawberries'],
      ['bread_ww', 32, '1 slice whole-wheat toast'],
      ['egg', 50, '1 large egg, fried in a nonstick pan or boiled'],
    ],
    method: 'Cook the egg and set it on the toast. Top the cottage cheese with the berries.',
  },
  {
    id: 'b-burrito', slot: 'breakfast', name: 'Breakfast burrito', mins: 10,
    items: [
      ['tortilla_ww', 49, '1 whole-wheat tortilla (8 inch)'],
      ['egg', 50, '1 large egg'],
      ['egg_whites', 122, '½ cup liquid egg whites'],
      ['beans', 60, '⅓ cup black beans, rinsed'],
      ['cheese_reduced_fat', 20, '3 tbsp reduced-fat shredded cheese'],
      ['salsa', 32, '2 tbsp salsa'],
    ],
    method: 'Scramble the egg with the whites, warm the beans, and roll everything up in the tortilla.',
  },
  {
    id: 'b-avotoast', slot: 'breakfast', name: 'Avocado egg toast', mins: 10,
    items: [
      ['bread_ww', 64, '2 slices whole-wheat toast'],
      ['avocado', 40, '¼ avocado, mashed'],
      ['egg', 50, '1 large egg'],
      ['egg_whites', 160, '⅔ cup liquid egg whites'],
      ['tomato', 100, '1 small tomato, sliced'],
    ],
    method: 'Scramble the egg with the whites. Spread the avocado on the toast and top with the eggs and tomato.',
  },

  // ---------- Lunches (about 500 kcal) ----------
  {
    id: 'l-wrap', slot: 'lunch', name: 'Turkey and hummus wrap with yogurt', mins: 5,
    items: [
      ['tortilla_ww', 49, '1 whole-wheat tortilla (8 inch)'],
      ['deli_turkey', 113, '4 oz deli turkey breast'],
      ['hummus', 45, '3 tbsp hummus'],
      ['salad_greens', 30, 'a handful of lettuce'],
      ['tomato', 40, 'a few tomato slices'],
      ['cucumber', 40, 'a few cucumber slices'],
      ['greek_yogurt', 170, '¾ cup nonfat plain Greek yogurt'],
      ['strawberries', 100, '⅔ cup strawberries'],
    ],
    method: 'Spread the hummus on the tortilla, layer on the turkey and vegetables, and roll up. Yogurt and berries on the side.',
  },
  {
    id: 'l-greek', slot: 'lunch', name: 'Greek chicken salad', mins: 10,
    items: [
      ['chicken_cooked', 140, '5 oz cooked chicken breast, sliced'],
      ['salad_greens', 120, '2½ cups chopped romaine'],
      ['cucumber', 80, '½ small cucumber, chopped'],
      ['tomato', 80, '1 small tomato, chopped'],
      ['feta', 30, '1 oz crumbled feta (3 tbsp)'],
      ['chickpeas', 60, '⅓ cup chickpeas, rinsed'],
      ['olive_oil', 9, '2 tsp olive oil'],
    ],
    method: 'Toss everything with the oil, a squeeze of lemon, oregano, salt and pepper.',
  },
  {
    id: 'l-chili', slot: 'lunch', name: 'Turkey chili', mins: 30,
    items: [
      ['turkey_93_raw', 142, '5 oz 93% lean ground turkey (raw weight)'],
      ['beans', 115, '⅔ cup kidney or black beans, rinsed'],
      ['canned_tomatoes', 165, '⅔ cup canned diced tomatoes'],
      ['onion', 40, '⅓ onion, diced'],
      ['bell_pepper', 40, '⅓ bell pepper, diced'],
      ['olive_oil', 4.5, '1 tsp olive oil'],
      ['cheese_reduced_fat', 20, '3 tbsp reduced-fat shredded cheese'],
    ],
    method: 'Brown the turkey with the onion and pepper in the oil. Add the tomatoes, beans, chili powder and cumin, and simmer 20 minutes. Top with the cheese. Cook four portions at once; it reheats well.',
  },
  {
    id: 'l-bowl', slot: 'lunch', name: 'Chicken burrito bowl', mins: 10,
    items: [
      ['chicken_cooked', 140, '5 oz cooked chicken breast, diced'],
      ['brown_rice', 100, '½ cup cooked brown rice'],
      ['beans', 85, '½ cup black beans, rinsed'],
      ['salsa', 65, '¼ cup salsa'],
      ['avocado', 35, '¼ small avocado, diced'],
      ['salad_greens', 50, '1 cup shredded lettuce'],
    ],
    method: 'Layer the rice, beans and chicken over the lettuce. Top with salsa and avocado.',
  },
  {
    id: 'l-tuna', slot: 'lunch', name: 'Tuna salad sandwich with carrots and an apple', mins: 10,
    items: [
      ['bread_ww', 64, '2 slices whole-wheat bread'],
      ['tuna_canned', 113, '1 can (5 oz) tuna in water, drained'],
      ['light_mayo', 15, '1 tbsp light mayonnaise'],
      ['greek_yogurt', 30, '2 tbsp nonfat plain Greek yogurt'],
      ['carrots', 100, '10 baby carrots'],
      ['string_cheese', 28, '1 string cheese'],
      ['apple', 182, '1 medium apple'],
    ],
    method: 'Mix the tuna with the mayonnaise, yogurt, pepper and a little mustard, and make the sandwich. Carrots, cheese and apple on the side.',
  },
  {
    id: 'l-quinoa', slot: 'lunch', name: 'Chicken, quinoa and roasted vegetable bowl', mins: 25,
    items: [
      ['chicken_cooked', 130, '4½ oz cooked chicken breast'],
      ['quinoa', 140, '¾ cup cooked quinoa'],
      ['broccoli', 100, '1 cup broccoli florets'],
      ['zucchini', 80, '½ small zucchini, sliced'],
      ['bell_pepper', 50, '⅓ bell pepper, sliced'],
      ['olive_oil', 9, '2 tsp olive oil'],
    ],
    method: 'Roast the vegetables in the oil at 425°F for 20 minutes. Serve over the quinoa with the chicken. Good for batch cooking.',
  },
  {
    id: 'l-tacosalad', slot: 'lunch', name: 'Turkey taco salad', mins: 15,
    items: [
      ['turkey_93_raw', 142, '5 oz 93% lean ground turkey (raw weight)'],
      ['taco_seasoning', 6, '2 tsp taco seasoning'],
      ['salad_greens', 100, '2 cups chopped romaine'],
      ['beans', 60, '⅓ cup black beans, rinsed'],
      ['corn', 55, '⅓ cup corn kernels'],
      ['tomato', 60, '½ tomato, diced'],
      ['salsa', 65, '¼ cup salsa'],
      ['cheese_reduced_fat', 20, '3 tbsp reduced-fat shredded cheese'],
      ['greek_yogurt', 30, '2 tbsp nonfat plain Greek yogurt, as sour cream'],
      ['avocado', 35, '¼ small avocado, diced'],
    ],
    method: 'Brown the turkey with the seasoning. Pile it over the lettuce with everything else. The salsa is the dressing.',
  },

  // ---------- Dinners (about 600 kcal) ----------
  {
    id: 'd-sheetpan', slot: 'dinner', name: 'Sheet-pan lemon chicken with potatoes and green beans', mins: 40,
    items: [
      ['chicken_raw', 180, '6½ oz chicken breast (raw weight)'],
      ['potato', 250, '9 oz baby potatoes, halved'],
      ['green_beans', 150, '1½ cups green beans'],
      ['olive_oil', 13.5, '1 tbsp olive oil'],
    ],
    method: 'Toss everything with the oil, lemon, garlic, salt and pepper. Roast at 425°F: potatoes alone for 15 minutes, then add the chicken and beans for 20 more.',
  },
  {
    id: 'd-tacos', slot: 'dinner', name: 'Turkey tacos', mins: 20,
    items: [
      ['tortilla_corn', 78, '3 corn tortillas (6 inch)'],
      ['turkey_93_raw', 142, '5 oz 93% lean ground turkey (raw weight)'],
      ['taco_seasoning', 6, '2 tsp taco seasoning'],
      ['salad_greens', 40, '1 cup shredded lettuce'],
      ['tomato', 60, '½ tomato, diced'],
      ['salsa', 48, '3 tbsp salsa'],
      ['cheese_reduced_fat', 20, '3 tbsp reduced-fat shredded cheese'],
      ['avocado', 35, '¼ small avocado, diced'],
      ['beans', 60, '⅓ cup black beans, on the side'],
    ],
    method: 'Brown the turkey with the seasoning and a splash of water. Warm the tortillas and build the tacos.',
  },
  {
    id: 'd-salmon', slot: 'dinner', name: 'Baked salmon with brown rice and broccoli', mins: 25,
    items: [
      ['salmon_raw', 170, '6 oz salmon fillet (raw weight)'],
      ['brown_rice', 100, '½ cup cooked brown rice'],
      ['broccoli', 200, '2 cups broccoli florets'],
      ['olive_oil', 4.5, '1 tsp olive oil'],
    ],
    method: 'Bake the salmon at 400°F for 12 to 15 minutes with lemon, salt and pepper. Roast or steam the broccoli with the oil.',
  },
  {
    id: 'd-spaghetti', slot: 'dinner', name: 'Spaghetti with turkey meat sauce and side salad', mins: 25,
    items: [
      ['pasta_ww_dry', 64, '2¼ oz whole-wheat spaghetti (dry weight)'],
      ['turkey_93_raw', 142, '5 oz 93% lean ground turkey (raw weight)'],
      ['marinara', 125, '½ cup marinara sauce'],
      ['salad_greens', 100, '2 cups salad greens'],
      ['olive_oil', 4.5, '1 tsp olive oil, with vinegar'],
      ['parmesan', 5, '1 tbsp grated parmesan'],
    ],
    method: 'Brown the turkey, add the marinara and simmer while the pasta cooks. Dress the salad with the oil and vinegar.',
  },
  {
    id: 'd-pizza', slot: 'dinner', name: 'Chicken pita pizza with salad', mins: 15,
    items: [
      ['pita_ww', 64, '1 whole-wheat pita (6½ inch)'],
      ['marinara', 62, '¼ cup marinara sauce'],
      ['mozzarella', 56, '½ cup shredded part-skim mozzarella'],
      ['chicken_cooked', 100, '3½ oz cooked chicken breast, shredded'],
      ['mushrooms', 40, '2 mushrooms, sliced'],
      ['bell_pepper', 30, 'a few strips of bell pepper'],
      ['salad_greens', 100, '2 cups salad greens'],
      ['olive_oil', 4.5, '1 tsp olive oil, with vinegar'],
    ],
    method: 'Top the pita with the sauce, chicken, vegetables and cheese. Bake at 425°F for 8 to 10 minutes. Salad on the side.',
  },
  {
    id: 'd-burger', slot: 'dinner', name: 'Lean burger with sweet potato wedges', mins: 35,
    items: [
      ['beef_93_raw', 151, '⅓ lb 93% lean ground beef patty (raw weight)'],
      ['bun_ww', 52, '1 whole-wheat bun'],
      ['sweet_potato', 170, '1 medium sweet potato (6 oz), cut in wedges'],
      ['olive_oil', 4.5, '1 tsp olive oil'],
      ['salad_greens', 80, 'lettuce, plus a side of greens'],
      ['tomato', 50, 'tomato slices'],
      ['ketchup', 17, '1 tbsp ketchup'],
    ],
    method: 'Toss the wedges in the oil and roast at 425°F for 25 minutes. Grill or pan-sear the patty about 4 minutes a side.',
  },
  {
    id: 'd-steak', slot: 'dinner', name: 'Sirloin steak with baked potato and green beans', mins: 30,
    items: [
      ['sirloin_raw', 170, '6 oz top sirloin steak, trimmed (raw weight)'],
      ['potato', 250, '1 large russet potato (9 oz)'],
      ['greek_yogurt', 30, '2 tbsp nonfat plain Greek yogurt, as sour cream'],
      ['green_beans', 150, '1½ cups green beans'],
      ['olive_oil', 9, '2 tsp olive oil'],
    ],
    method: 'Bake or microwave the potato. Sear the steak 3 to 4 minutes a side and rest it 5 minutes. Sauté the beans in the oil with garlic.',
  },
  {
    id: 'd-teriyaki', slot: 'dinner', name: 'Teriyaki chicken stir-fry', mins: 20,
    items: [
      ['chicken_raw', 170, '6 oz chicken breast, sliced (raw weight)'],
      ['stirfry_veg', 250, '2½ cups plain frozen stir-fry vegetables (no sauce packet)'],
      ['white_rice', 158, '1 cup cooked white rice'],
      ['teriyaki', 36, '2 tbsp teriyaki sauce'],
      ['olive_oil', 7, '1½ tsp cooking oil'],
    ],
    method: 'Stir-fry the chicken in the oil until cooked through, add the vegetables for 4 minutes, then the sauce. Serve over the rice.',
  },
  {
    id: 'd-cod', slot: 'dinner', name: 'Baked cod with roasted potatoes and asparagus', mins: 35,
    items: [
      ['cod_raw', 200, '7 oz cod fillet (raw weight)'],
      ['potato', 300, '10½ oz potatoes, cubed'],
      ['asparagus', 150, '9 asparagus spears'],
      ['olive_oil', 13.5, '1 tbsp olive oil'],
      ['parmesan', 10, '2 tbsp grated parmesan'],
    ],
    method: 'Roast the potatoes in half the oil at 425°F for 20 minutes. Add the cod and asparagus with the rest of the oil and roast 12 minutes more. Parmesan over the asparagus.',
  },
  {
    id: 'd-parm', slot: 'dinner', name: 'Baked chicken parmesan with pasta and salad', mins: 30,
    items: [
      ['chicken_raw', 170, '6 oz chicken breast, pounded thin (raw weight)'],
      ['panko', 15, '¼ cup panko breadcrumbs'],
      ['marinara', 125, '½ cup marinara sauce'],
      ['mozzarella', 28, '¼ cup shredded part-skim mozzarella'],
      ['pasta_ww_dry', 43, '1½ oz whole-wheat pasta (dry weight)'],
      ['salad_greens', 100, '2 cups salad greens'],
      ['olive_oil', 4.5, '1 tsp olive oil, with vinegar'],
    ],
    method: 'Press the chicken into the panko and bake at 425°F for 15 minutes. Top with half the sauce and the cheese and bake 5 more. Toss the pasta with the rest of the sauce.',
  },
  {
    id: 'd-eggroll', slot: 'dinner', name: 'Egg roll in a bowl', mins: 20,
    items: [
      ['turkey_93_raw', 170, '6 oz 93% lean ground turkey (raw weight)'],
      ['cabbage', 250, '3 cups coleslaw mix'],
      ['soy_sauce', 16, '1 tbsp soy sauce'],
      ['sesame_oil', 4.5, '1 tsp sesame oil'],
      ['white_rice', 118, '¾ cup cooked white rice'],
      ['egg', 50, '1 large egg'],
    ],
    method: 'Brown the turkey with garlic and ginger. Add the coleslaw mix and soy sauce and cook until just tender. Push it aside, scramble in the egg, and finish with the sesame oil. Serve over the rice.',
  },
  {
    id: 'd-beefbroc', slot: 'dinner', name: 'Beef and broccoli stir-fry', mins: 25,
    items: [
      ['sirloin_raw', 170, '6 oz top sirloin, thinly sliced (raw weight)'],
      ['broccoli', 200, '2 cups broccoli florets'],
      ['white_rice', 118, '¾ cup cooked white rice'],
      ['soy_sauce', 16, '1 tbsp soy sauce'],
      ['olive_oil', 9, '2 tsp cooking oil'],
      ['honey', 7, '1 tsp honey'],
      ['cornstarch', 3, '1 tsp cornstarch'],
    ],
    method: 'Mix the soy sauce, honey and cornstarch with ¼ cup water. Sear the beef in the oil, add the broccoli with a splash of water and cover for 3 minutes, then stir in the sauce until glossy. Serve over the rice.',
  },
  {
    id: 'd-fajitas', slot: 'dinner', name: 'Chicken fajitas', mins: 25,
    items: [
      ['chicken_raw', 170, '6 oz chicken breast, sliced (raw weight)'],
      ['bell_pepper', 150, '1 large bell pepper, sliced'],
      ['onion', 80, '½ large onion, sliced'],
      ['tortilla_corn', 78, '3 corn tortillas (6 inch)'],
      ['olive_oil', 7, '1½ tsp olive oil'],
      ['salsa', 65, '¼ cup salsa'],
      ['greek_yogurt', 30, '2 tbsp nonfat plain Greek yogurt, as sour cream'],
      ['avocado', 35, '¼ small avocado, diced'],
    ],
    method: 'Sear the chicken in the oil with chili powder and cumin, then cook the pepper and onion until charred at the edges. Serve in warm tortillas with the salsa, yogurt and avocado.',
  },

  // ---------- Snacks ----------
  // The app picks snacks that fit the calories the three meals leave over,
  // working down this list in turn, so the order here sets the variety.
  {
    id: 's-sandwich-apple', slot: 'snack', name: 'Turkey sandwich and an apple', mins: 5,
    items: [
      ['bread_ww', 64, '2 slices whole-wheat bread'],
      ['deli_turkey', 113, '4 oz deli turkey breast'],
      ['string_cheese', 28, '1 string cheese, pulled apart'],
      ['salad_greens', 20, 'lettuce'],
      ['apple', 182, '1 medium apple'],
    ],
    method: 'Build the sandwich with mustard. Apple on the side.',
  },
  {
    id: 's-cottage-banana-oats', slot: 'snack', name: 'Cottage cheese banana bowl with oats', mins: 3,
    items: [
      ['cottage_cheese', 226, '1 cup 2% cottage cheese'],
      ['banana', 118, '1 medium banana, sliced'],
      ['oats', 20, '¼ cup rolled oats'],
      ['chia', 12, '1 tbsp chia seeds'],
      ['honey', 7, '1 tsp honey'],
    ],
    method: 'Stir the oats and chia into the cottage cheese. Top with the banana and honey.',
  },
  {
    id: 's-sandwich', slot: 'snack', name: 'Turkey and cheese sandwich', mins: 5,
    items: [
      ['bread_ww', 64, '2 slices whole-wheat bread'],
      ['deli_turkey', 113, '4 oz deli turkey breast'],
      ['string_cheese', 28, '1 string cheese, pulled apart'],
      ['salad_greens', 20, 'lettuce'],
    ],
    method: 'Build the sandwich with mustard.',
  },
  {
    id: 's-loaded-yogurt', slot: 'snack', name: 'Loaded yogurt bowl with banana and oats', mins: 3,
    items: [
      ['greek_yogurt', 245, '1 cup nonfat plain Greek yogurt'],
      ['banana', 118, '1 medium banana, sliced'],
      ['oats', 27, '⅓ cup rolled oats'],
      ['chia', 6, '1½ tsp chia seeds'],
    ],
    method: 'Stir the oats and chia into the yogurt and top with the banana.',
  },
  {
    id: 's-smoothie', slot: 'snack', name: 'Banana oat protein smoothie', mins: 3,
    items: [
      ['whey', 30, '1 scoop whey protein'],
      ['banana', 118, '1 medium banana'],
      ['oats', 20, '¼ cup rolled oats'],
      ['milk_1', 183, '¾ cup 1% milk'],
    ],
    method: 'Blend with a cup of ice. Good within an hour after training.',
  },
  {
    id: 's-cottage-apple-cheese', slot: 'snack', name: 'Cottage cheese, an apple and string cheese', mins: 3,
    items: [
      ['cottage_cheese', 226, '1 cup 2% cottage cheese'],
      ['apple', 182, '1 medium apple, sliced'],
      ['string_cheese', 28, '1 string cheese'],
    ],
    method: 'Slice the apple over the cottage cheese. Cinnamon is good on this.',
  },
  {
    id: 's-parfait', slot: 'snack', name: 'Yogurt parfait with oats', mins: 3,
    items: [
      ['greek_yogurt', 245, '1 cup nonfat plain Greek yogurt'],
      ['blueberries', 100, '⅔ cup blueberries'],
      ['oats', 27, '⅓ cup rolled oats'],
    ],
    method: 'Layer in a bowl or jar. Toast the oats in a dry pan first if you like them crunchy.',
  },
  {
    id: 's-shake-egg-toast', slot: 'snack', name: 'Protein shake and egg on toast', mins: 6,
    items: [
      ['whey', 30, '1 scoop whey protein, shaken with water'],
      ['bread_ww', 32, '1 slice whole-wheat toast'],
      ['egg', 50, '1 large egg, fried in a nonstick pan or boiled'],
    ],
    method: 'Shake the protein with cold water. Set the egg on the toast.',
  },
  {
    id: 's-cottage-berries-banana', slot: 'snack', name: 'Cottage cheese with strawberries and banana', mins: 3,
    items: [
      ['cottage_cheese', 226, '1 cup 2% cottage cheese'],
      ['strawberries', 150, '1 cup strawberries'],
      ['banana', 100, '1 small banana, sliced'],
    ],
    method: 'Top the cottage cheese with the fruit.',
  },
  {
    id: 's-eggs-apple', slot: 'snack', name: 'Hard-boiled eggs, an apple and string cheese', mins: 2,
    items: [
      ['egg', 100, '2 hard-boiled eggs'],
      ['apple', 182, '1 medium apple'],
      ['string_cheese', 28, '1 string cheese'],
    ],
    method: 'Boil a batch of eggs on Sunday and keep them in the fridge.',
  },
  {
    id: 's-shake-apple-cheese', slot: 'snack', name: 'Protein shake, an apple and string cheese', mins: 2,
    items: [
      ['whey', 30, '1 scoop whey protein, shaken with water'],
      ['apple', 182, '1 medium apple'],
      ['string_cheese', 28, '1 string cheese'],
    ],
    method: 'Shake the protein with cold water.',
  },
  {
    id: 's-milk-shake-banana', slot: 'snack', name: 'Protein shake made with milk and a banana', mins: 2,
    items: [
      ['whey', 30, '1 scoop whey protein'],
      ['milk_1', 183, '¾ cup 1% milk'],
      ['banana', 118, '1 medium banana'],
    ],
    method: 'Shake the protein with the milk. Good within an hour after training.',
  },
  {
    id: 's-edamame-cheese', slot: 'snack', name: 'Edamame and string cheese', mins: 3,
    items: [
      ['edamame', 150, '1 cup shelled edamame'],
      ['string_cheese', 28, '1 string cheese'],
    ],
    method: 'Microwave frozen edamame for 2 minutes and salt lightly.',
  },
  {
    id: 's-rollups-apple', slot: 'snack', name: 'Turkey roll-ups, string cheese and an apple', mins: 3,
    items: [
      ['deli_turkey', 85, '3 oz deli turkey breast'],
      ['string_cheese', 28, '1 string cheese'],
      ['apple', 182, '1 medium apple'],
    ],
    method: 'Roll the turkey around the cheese, with mustard if you like.',
  },
  {
    id: 's-shake-banana', slot: 'snack', name: 'Protein shake and a banana', mins: 2,
    items: [
      ['whey', 30, '1 scoop whey protein, shaken with water'],
      ['banana', 118, '1 medium banana'],
    ],
    method: 'Good within an hour after training.',
  },
  {
    id: 's-yogurt-oats', slot: 'snack', name: 'Greek yogurt with blueberries and oats', mins: 2,
    items: [
      ['greek_yogurt', 170, '¾ cup nonfat plain Greek yogurt'],
      ['blueberries', 80, '½ cup blueberries'],
      ['oats', 20, '¼ cup rolled oats'],
    ],
    method: 'Stir together.',
  },
  {
    id: 's-hummus-cheese', slot: 'snack', name: 'Hummus, vegetables and string cheese', mins: 3,
    items: [
      ['hummus', 45, '3 tbsp hummus'],
      ['carrots', 80, '8 baby carrots'],
      ['cucumber', 70, '½ small cucumber, sliced'],
      ['string_cheese', 28, '1 string cheese'],
    ],
    method: 'Dip the vegetables in the hummus.',
  },
  {
    id: 's-rollups', slot: 'snack', name: 'Turkey and cheese roll-ups', mins: 3,
    items: [
      ['deli_turkey', 85, '3 oz deli turkey breast'],
      ['string_cheese', 28, '1 string cheese'],
      ['cucumber', 100, '½ cucumber, sliced'],
    ],
    method: 'Roll the turkey around the cheese. Cucumber on the side.',
  },
  {
    id: 's-cottage', slot: 'snack', name: 'Cottage cheese and strawberries', mins: 2,
    items: [
      ['cottage_cheese', 170, '¾ cup 2% cottage cheese'],
      ['strawberries', 100, '⅔ cup strawberries'],
    ],
    method: 'Top the cottage cheese with the berries.',
  },
  {
    id: 's-eggs', slot: 'snack', name: 'Hard-boiled eggs and strawberries', mins: 2,
    items: [
      ['egg', 100, '2 hard-boiled eggs'],
      ['strawberries', 150, '1 cup strawberries'],
    ],
    method: 'Boil a batch of eggs on Sunday and keep them in the fridge.',
  },
  {
    id: 's-edamame', slot: 'snack', name: 'Edamame', mins: 3,
    items: [['edamame', 150, '1 cup shelled edamame']],
    method: 'Microwave frozen edamame for 2 minutes and salt lightly.',
  },
  {
    id: 's-yogurt', slot: 'snack', name: 'Greek yogurt and strawberries', mins: 2,
    items: [
      ['greek_yogurt', 170, '¾ cup nonfat plain Greek yogurt'],
      ['strawberries', 100, '⅔ cup strawberries'],
    ],
    method: 'Stir together.',
  },
  {
    id: 's-shake', slot: 'snack', name: 'Protein shake', mins: 1,
    items: [['whey', 30, '1 scoop whey protein, shaken with water']],
    method: 'Shake with cold water.',
  },
  {
    id: 's-turkey-cheese', slot: 'snack', name: 'Turkey slices and string cheese', mins: 1,
    items: [
      ['deli_turkey', 57, '2 oz deli turkey breast'],
      ['string_cheese', 28, '1 string cheese'],
    ],
    method: 'Nothing to it.',
  },
  {
    id: 's-cottage-cucumber', slot: 'snack', name: 'Cottage cheese and cucumber', mins: 2,
    items: [
      ['cottage_cheese', 113, '½ cup 2% cottage cheese'],
      ['cucumber', 100, '½ cucumber, sliced'],
    ],
    method: 'Salt and pepper the cucumber and scoop up the cottage cheese with it.',
  },
  {
    // Only offered as a swap: too little protein for the app to pick on its own.
    id: 's-apple', slot: 'snack', name: 'An apple', mins: 1, manualOnly: true,
    items: [['apple', 182, '1 medium apple']],
    method: 'Nothing to it.',
  },
];

// Two-week rotation. Day 0 is the Monday of week A, day 7 the Monday of week B.
// Snacks are not listed: the app picks one that fits what the meals leave over.
export const ROTATION = [
  // Week A
  { breakfast: 'b-oats', lunch: 'l-wrap', dinner: 'd-sheetpan' },
  { breakfast: 'b-scramble', lunch: 'l-greek', dinner: 'd-tacos' },
  { breakfast: 'b-yogurt', lunch: 'l-chili', dinner: 'd-salmon' },
  { breakfast: 'b-shake', lunch: 'l-bowl', dinner: 'd-spaghetti' },
  { breakfast: 'b-cottage', lunch: 'l-tuna', dinner: 'd-pizza' },
  { breakfast: 'b-burrito', lunch: 'l-quinoa', dinner: 'd-burger' },
  { breakfast: 'b-avotoast', lunch: 'l-tacosalad', dinner: 'd-steak' },
  // Week B
  { breakfast: 'b-oats', lunch: 'l-tuna', dinner: 'd-teriyaki' },
  { breakfast: 'b-scramble', lunch: 'l-quinoa', dinner: 'd-tacos' },
  { breakfast: 'b-yogurt', lunch: 'l-chili', dinner: 'd-cod' },
  { breakfast: 'b-shake', lunch: 'l-tacosalad', dinner: 'd-parm' },
  { breakfast: 'b-cottage', lunch: 'l-greek', dinner: 'd-eggroll' },
  { breakfast: 'b-burrito', lunch: 'l-bowl', dinner: 'd-beefbroc' },
  { breakfast: 'b-avotoast', lunch: 'l-wrap', dinner: 'd-fajitas' },
];

const round5 = (n) => Math.round(n / 5) * 5;

function nutritionFor(items) {
  const sum = [0, 0, 0, 0, 0];
  for (const [food, grams] of items) {
    const per100 = FOODS[food];
    if (!per100) throw new Error(`Unknown food "${food}" in js/meals.js`);
    for (let i = 0; i < 5; i += 1) sum[i] += (per100[i] * grams) / 100;
  }
  return {
    kcal: round5(sum[0]),
    protein: Math.round(sum[1]),
    carbs: Math.round(sum[2]),
    fat: Math.round(sum[3]),
    fiber: Math.round(sum[4]),
  };
}

export const MEALS = RAW_MEALS.map((meal) => Object.freeze({ ...meal, ...nutritionFor(meal.items) }));

const BY_ID = new Map(MEALS.map((meal) => [meal.id, meal]));

export function mealById(id) {
  return BY_ID.get(id) || null;
}

export function mealsForSlot(slot) {
  return MEALS.filter((meal) => meal.slot === slot);
}
