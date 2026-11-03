// Fuel product library. Values are per serving (one gel, one pack of chews,
// one capsule) and are approximate: brands reformulate, and flavors differ.
// Runners should confirm against the package label. Drinks are per fluid ounce.
window.PRODUCTS = [
  // Gels
  { id: 'maurten-100',      type: 'gel', name: 'Maurten Gel 100',                 carbs: 25, sodium: 0,   caffeine: 0,   kcal: 100 },
  { id: 'maurten-caf100',   type: 'gel', name: 'Maurten Gel 100 Caf 100',         carbs: 25, sodium: 0,   caffeine: 100, kcal: 100 },
  { id: 'maurten-160',      type: 'gel', name: 'Maurten Gel 160',                 carbs: 40, sodium: 0,   caffeine: 0,   kcal: 160 },
  { id: 'gu-energy',        type: 'gel', name: 'GU Energy Gel (caffeinated flavor)', carbs: 22, sodium: 60, caffeine: 20, kcal: 100 },
  { id: 'gu-energy-nocaf',  type: 'gel', name: 'GU Energy Gel (caffeine-free flavor)', carbs: 22, sodium: 60, caffeine: 0, kcal: 100 },
  { id: 'gu-roctane',       type: 'gel', name: 'GU Roctane Gel',                  carbs: 21, sodium: 125, caffeine: 35,  kcal: 100 },
  { id: 'sis-go',           type: 'gel', name: 'SiS GO Isotonic Gel',             carbs: 22, sodium: 10,  caffeine: 0,   kcal: 87 },
  { id: 'sis-go-caf',       type: 'gel', name: 'SiS GO Energy + Caffeine Gel',    carbs: 22, sodium: 10,  caffeine: 75,  kcal: 87 },
  { id: 'sis-beta',         type: 'gel', name: 'SiS Beta Fuel Gel',               carbs: 40, sodium: 20,  caffeine: 0,   kcal: 158 },
  { id: 'honey-stinger',    type: 'gel', name: 'Honey Stinger Energy Gel',        carbs: 24, sodium: 50,  caffeine: 0,   kcal: 100 },
  { id: 'honey-stinger-caf',type: 'gel', name: 'Honey Stinger Energy Gel (caffeinated)', carbs: 24, sodium: 50, caffeine: 32, kcal: 100 },
  { id: 'pf30',             type: 'gel', name: 'Precision Fuel PF 30 Gel',        carbs: 30, sodium: 0,   caffeine: 0,   kcal: 120 },
  { id: 'pf30-caf',         type: 'gel', name: 'Precision Fuel PF 30 Caffeine Gel', carbs: 30, sodium: 0, caffeine: 100, kcal: 120 },
  { id: 'huma',             type: 'gel', name: 'Huma Chia Energy Gel',            carbs: 22, sodium: 105, caffeine: 0,   kcal: 100 },
  { id: 'huma-caf',         type: 'gel', name: 'Huma Chia Energy Gel (caffeinated)', carbs: 22, sodium: 105, caffeine: 25, kcal: 100 },
  { id: 'clif-shot',        type: 'gel', name: 'Clif Shot Energy Gel',            carbs: 24, sodium: 60,  caffeine: 0,   kcal: 100 },
  { id: 'clif-shot-caf',    type: 'gel', name: 'Clif Shot Energy Gel (caffeinated)', carbs: 24, sodium: 60, caffeine: 50, kcal: 100 },
  { id: 'neversecond-c30',  type: 'gel', name: 'Neversecond C30 Gel',             carbs: 30, sodium: 200, caffeine: 0,   kcal: 120 },
  { id: 'neversecond-c30-caf', type: 'gel', name: 'Neversecond C30+ Caffeine Gel', carbs: 30, sodium: 200, caffeine: 75, kcal: 120 },
  // Chews (one serving)
  { id: 'clif-bloks',       type: 'chew', name: 'Clif Bloks (3 bloks)',           carbs: 24, sodium: 50,  caffeine: 0,   kcal: 100 },
  { id: 'hs-chews',         type: 'chew', name: 'Honey Stinger Chews (1 pack)',   carbs: 39, sodium: 80,  caffeine: 0,   kcal: 160 },
  { id: 'skratch-chews',    type: 'chew', name: 'Skratch Energy Chews (1 pack)',  carbs: 36, sodium: 80,  caffeine: 0,   kcal: 160 },
  // Salt capsules
  { id: 'saltstick',        type: 'salt', name: 'SaltStick Caps',                 carbs: 0,  sodium: 215, caffeine: 0,   kcal: 0 },
  { id: 'ph-capsule',       type: 'salt', name: 'Precision Hydration Electrolyte Capsule', carbs: 0, sodium: 250, caffeine: 0, kcal: 0 },
  // Course food
  { id: 'banana',           type: 'food', name: 'Banana (half)',                  carbs: 13, sodium: 0,   caffeine: 0,   kcal: 50 },
  // Drinks, per fluid ounce
  { id: 'gatorade-endurance', type: 'drink', name: 'Gatorade Endurance Formula', perOz: { carbs: 22 / 12, sodium: 300 / 12, kcal: 90 / 12 } },
  { id: 'water',            type: 'drink', name: 'Water',                          perOz: { carbs: 0, sodium: 0, kcal: 0 } },
];
window.PRODUCT_BY_ID = Object.fromEntries(window.PRODUCTS.map(p => [p.id, p]));
