// Nutrition per 100 g: [calories, protein g, carbs g, fat g, fiber g].
// Values are rounded from USDA FoodData Central and typical US package labels.
// They are estimates: brands differ, so treat every total as "about".
// Meat and fish marked "raw" are weighed before cooking; "cooked" after.
//
// This list is kept free of peanuts and tree nuts on purpose.
// tools/check-plan.mjs fails if one is added.

export const FOODS = {
  // Meat, fish, eggs
  chicken_cooked: [165, 31.0, 0, 3.6, 0],
  chicken_raw: [120, 22.5, 0, 2.6, 0],
  turkey_93_raw: [150, 18.7, 0, 8.3, 0],
  beef_93_raw: [152, 20.9, 0, 7.0, 0],
  sirloin_raw: [140, 21.5, 0, 5.5, 0],
  salmon_raw: [208, 20.4, 0, 13.4, 0],
  cod_raw: [82, 17.8, 0, 0.7, 0],
  tuna_canned: [86, 19.4, 0, 1.0, 0],
  deli_turkey: [100, 18.0, 2.0, 2.0, 0],
  egg: [143, 12.6, 0.7, 9.5, 0],
  egg_whites: [52, 10.9, 0.7, 0.2, 0],

  // Dairy and protein powder
  greek_yogurt: [59, 10.2, 3.6, 0.4, 0],
  cottage_cheese: [81, 10.5, 4.8, 2.3, 0],
  milk_1: [42, 3.4, 5.0, 1.0, 0],
  cheese_reduced_fat: [286, 25.0, 3.6, 21.4, 0],
  string_cheese: [286, 25.0, 3.6, 21.4, 0],
  mozzarella: [254, 24.3, 2.8, 15.9, 0],
  feta: [264, 14.2, 4.1, 21.3, 0],
  parmesan: [420, 30.0, 12.0, 28.0, 0],
  whey: [400, 80.0, 10.0, 5.0, 0],

  // Grains and starches
  oats: [379, 13.2, 67.7, 6.5, 10.1],
  bread_ww: [252, 12.5, 42.7, 3.5, 6.0],
  tortilla_ww: [265, 8.2, 44.9, 7.1, 6.1],
  tortilla_corn: [218, 5.7, 44.6, 2.9, 6.3],
  pita_ww: [266, 9.8, 55.0, 2.6, 7.4],
  bun_ww: [269, 11.5, 48.0, 4.8, 5.8],
  brown_rice: [123, 2.7, 25.6, 1.0, 1.6],
  white_rice: [130, 2.7, 28.2, 0.3, 0.4],
  quinoa: [120, 4.4, 21.3, 1.9, 2.8],
  pasta_ww_dry: [352, 13.9, 73.4, 2.9, 9.2],
  potato: [77, 2.0, 17.5, 0.1, 2.1],
  sweet_potato: [86, 1.6, 20.1, 0.1, 3.0],
  panko: [395, 13.0, 72.0, 5.0, 4.5],
  cornstarch: [381, 0.3, 91.3, 0.1, 0.9],

  // Beans
  beans: [95, 6.2, 17.0, 0.4, 6.5],
  chickpeas: [139, 7.0, 22.5, 2.8, 6.4],
  hummus: [240, 7.0, 14.0, 17.0, 4.0],
  edamame: [121, 11.9, 8.9, 5.2, 5.2],

  // Vegetables
  broccoli: [34, 2.8, 6.6, 0.4, 2.6],
  spinach: [23, 2.9, 3.6, 0.4, 2.2],
  salad_greens: [17, 1.2, 3.3, 0.3, 2.1],
  bell_pepper: [26, 1.0, 6.0, 0.3, 2.1],
  onion: [40, 1.1, 9.3, 0.1, 1.7],
  tomato: [18, 0.9, 3.9, 0.2, 1.2],
  canned_tomatoes: [24, 1.0, 5.0, 0.2, 1.2],
  cucumber: [15, 0.7, 3.6, 0.1, 0.5],
  carrots: [41, 0.9, 9.6, 0.2, 2.8],
  green_beans: [31, 1.8, 7.0, 0.2, 2.7],
  asparagus: [20, 2.2, 3.9, 0.1, 2.1],
  zucchini: [17, 1.2, 3.1, 0.3, 1.0],
  mushrooms: [22, 3.1, 3.3, 0.3, 1.0],
  cabbage: [25, 1.3, 5.8, 0.1, 2.5],
  stirfry_veg: [35, 2.0, 7.0, 0.3, 2.5],
  corn: [81, 2.5, 19.3, 0.7, 2.4],

  // Fruit
  banana: [89, 1.1, 22.8, 0.3, 2.6],
  blueberries: [57, 0.7, 14.5, 0.3, 2.4],
  strawberries: [32, 0.7, 7.7, 0.3, 2.0],
  apple: [52, 0.3, 13.8, 0.2, 2.4],
  avocado: [160, 2.0, 8.5, 14.7, 6.7],

  // Fats, seeds, sauces
  olive_oil: [884, 0, 0, 100, 0],
  sesame_oil: [884, 0, 0, 100, 0],
  chia: [486, 16.5, 42.1, 30.7, 34.4],
  honey: [304, 0.3, 82.4, 0, 0.2],
  light_mayo: [233, 0.3, 6.7, 23.3, 0],
  salsa: [29, 1.5, 6.6, 0.2, 1.9],
  marinara: [51, 1.4, 8.1, 1.6, 1.8],
  soy_sauce: [53, 8.1, 4.9, 0.6, 0.8],
  teriyaki: [89, 5.9, 15.6, 0, 0.1],
  ketchup: [101, 1.0, 27.4, 0.1, 0.3],
  taco_seasoning: [300, 6.0, 58.0, 4.0, 12.0],
};
