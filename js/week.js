// Race-week nutrition engine. Pure functions, no DOM.
(function () {
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const r5 = v => Math.round(v / 5) * 5;

  // Carb reference items (grams of carbohydrate per listed serving).
  const ITEMS = {
    oatmeal: { name: '1 cup cooked oatmeal', carbs: 55, gf: '1 cup cooked gluten-free oats' },
    banana: { name: '1 banana', carbs: 27 },
    honey: { name: '1 tbsp honey', carbs: 17 },
    juice: { name: '250 ml fruit juice', carbs: 26 },
    bagel: { name: 'bagel with jam', carbs: 63, gf: '4 rice cakes with jam' , gfCarbs: 41 },
    rice: { name: '1 cup cooked white rice', carbs: 45 },
    sportsdrink: { name: '500 ml sports drink', carbs: 30 },
    pretzels: { name: '30 g pretzels', carbs: 23, gf: '30 g gluten-free pretzels' },
    dates: { name: '2 Medjool dates', carbs: 36 },
    pasta: { name: '1 cup cooked pasta', carbs: 43, gf: '1 cup cooked gluten-free pasta' },
    bread: { name: '1 slice white bread', carbs: 15, gf: '1 slice gluten-free bread' },
    potato: { name: '1 medium potato', carbs: 37 },
    sorbet: { name: '1 cup sorbet', carbs: 40 },
    granola: { name: '1 granola bar', carbs: 25 },
  };

  function menuFor(diet) {
    const protein = diet === 'vegan' ? 'tofu or tempeh' : diet === 'vegetarian' ? 'eggs, tofu or paneer' : 'chicken, fish or tofu';
    const dessert = diet === 'vegan' ? 'sorbet' : 'low-fat frozen yogurt or sorbet';
    return [
      { meal: 'Breakfast', parts: ['oatmeal', 'banana', 'honey', 'juice'] },
      { meal: 'Mid-morning', parts: ['bagel'] },
      { meal: 'Lunch', parts: ['rice', 'rice', 'sportsdrink'], extra: `with a modest portion of ${protein} and little fat` },
      { meal: 'Afternoon', parts: ['pretzels', 'dates'] },
      { meal: 'Dinner', parts: ['pasta', 'pasta', 'bread', 'bread'], extra: 'tomato-based sauce, small protein portion, skip the salad' },
      { meal: 'Evening', parts: ['sorbet'], extra: dessert },
    ];
  }

  function itemName(key, diet) {
    const it = ITEMS[key];
    return diet === 'glutenfree' && it.gf ? it.gf : it.name;
  }
  function itemCarbs(key, diet) {
    const it = ITEMS[key];
    return diet === 'glutenfree' && it.gfCarbs ? it.gfCarbs : it.carbs;
  }

  // Scale the template menu to hit a daily carb target. Returns lines of text.
  function sampleMenu(targetCarbs, diet) {
    const menu = menuFor(diet);
    const base = menu.reduce((s, m) => s + m.parts.reduce((t, k) => t + itemCarbs(k, diet), 0), 0);
    const scale = targetCarbs / base;
    return menu.map(m => {
      const counts = {};
      m.parts.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
      let total = 0;
      const parts = Object.entries(counts).map(([k, n]) => {
        const q = Math.max(0.5, Math.round(n * scale * 2) / 2);
        total += q * itemCarbs(k, diet);
        const nm = itemName(k, diet).replace(/^1 /, '');
        return `${q % 1 ? q : q.toFixed(0)} × ${nm}`;
      });
      return `${m.meal}: ${parts.join(', ')}${m.extra ? ` (${m.extra})` : ''} ≈ ${r5(total)} g`;
    });
  }

  // inputs: { course, kg, carbLoad, diet, cafTaper, lastRun, sweatNa, caffeineMgPerKg, dailyCaffeine, cramps, carry (from race-day plan) }
  function buildWeek(inp) {
    const course = inp.course;
    const kg = inp.kg;
    const race = new Date(course.date + 'T12:00:00');
    const warnings = [];
    const days = [];
    const saltySweater = inp.sweatNa >= 1200 || inp.cramps === 'often';

    const loadDays = inp.carbLoad === '3day' ? 3 : 2;
    const loadGkg = inp.carbLoad === '3day' ? 8 : inp.carbLoad === 'light' ? 6.5 : 10;

    for (let out = 6; out >= 1; out--) {
      const d = new Date(race); d.setDate(race.getDate() - out);
      const isLoad = out <= loadDays;
      const preLoad = out === loadDays + 1;
      let gkg = isLoad ? loadGkg : preLoad ? 7 : out >= 5 ? 5 : 6;
      const carbs = r5(gkg * kg);
      const protein = Math.round(1.6 * kg);
      const run = out === +inp.lastRun ? 'Last run of any length: 30 to 45 min easy with a few race-pace strides. Eat your race breakfast before it and take one gel during it.'
        : out === 1 ? 'Optional 15 to 20 min shakeout, or nothing. Short walk at most after that.'
        : out < +inp.lastRun ? 'Easy 20 to 30 min or rest. Legs should feel springy, not tired.'
        : 'Normal taper running, nothing hard.';
      const fluidMl = Math.round(35 * kg / 100) * 100 + (out === +inp.lastRun ? 500 : 0);
      const fiber = out <= 2 ? 'Low: white rice, white bread, peeled fruit, no beans or big salads.' : out === 3 ? 'Start easing back on fiber and fatty foods.' : 'Normal.';
      let caffeine;
      if (inp.cafTaper === 'taper') {
        caffeine = out >= 5 ? 'Usual intake.' : out >= 3 ? 'About half your usual.' : out === 2 ? 'One small coffee at most.' : 'None today; race morning dose will land harder.';
      } else caffeine = out === 1 ? 'Usual intake, last cup by early afternoon so sleep is clean.' : 'Usual intake.';
      const items = [];
      if (isLoad) items.push(`Carb load day ${loadDays - out + 1} of ${loadDays}: ${carbs} g carbs spread over 5 or 6 sittings. Drinks count. Keep fat and fiber low so the volume fits.`);
      if (preLoad) items.push('Ramp day: shift meals toward starch so tomorrow\'s load is not a shock.');
      if (out === 1) {
        items.push(`Sodium preload: add about ${saltySweater ? '2 to 3' : '1 to 2'} g sodium today through salted meals, broth or an electrolyte drink, on top of normal food. Sip rather than chug; aim for pale-yellow urine.`);
        items.push('Dinner by 7 pm, familiar food, nothing new. Set out breakfast for the morning.');
        if (inp.carry) items.push(`Pack: ${inp.carry}.`);
      }
      if (out === 2) items.push('Biggest eating day is today, not tomorrow. Finish dinner early; tomorrow is lighter and easier to digest.');
      if (out >= 4) items.push('Alcohol: fine in moderation until 3 days out.');
      if (out === 3) items.push('No alcohol from today through the race.');
      if (out === 3) items.push('Sleep matters most tonight and tomorrow night; race-eve sleep is usually poor and that is fine.');
      if (out === +inp.lastRun) items.push('Practice race-morning timing on this run: same breakfast, same gap to the start.');
      (course.weekLogistics && course.weekLogistics[out] || []).forEach(t => items.push(t));
      days.push({
        daysOut: out, date: d, weekday: WEEKDAYS[d.getDay()], dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        run, carbs, gkg, protein, fluidMl, fiber, caffeine, items, isLoad,
        meals: isLoad ? sampleMenu(carbs, inp.diet) : null,
      });
    }

    const loadTotal = days.filter(x => x.isLoad).reduce((s, x) => s + x.carbs, 0);
    if (loadGkg >= 10) warnings.push('A 10 g/kg load is a lot of food. If you have never eaten this much, use the three-day option or the light option; a partial load still helps.');
    if (inp.cramps !== 'never') warnings.push('With a cramp history, treat the race-eve sodium preload as required, not optional, and do not skip the salt capsules on the Race day tab.');
    if (inp.diet === 'glutenfree') warnings.push('Gluten-free loading is easier with rice, potatoes, corn tortillas and GF oats than with substitute breads, which are often low in carbs per slice.');

    const examples = Object.values(ITEMS).map(it => ({ name: it.name, carbs: it.carbs }));
    return {
      days, warnings, examples,
      summary: { loadDays, loadGkg, loadCarbs: r5(loadGkg * kg), loadTotal, protein: Math.round(1.6 * kg), saltySweater, expo: course.expo },
    };
  }

  window.Week = { buildWeek, sampleMenu };
})();
