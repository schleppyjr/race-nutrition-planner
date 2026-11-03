// Fueling engine. Pure functions: inputs in, plan out. No DOM access.
(function () {
  const P = window.PRODUCT_BY_ID;
  const OZ_ML = 29.5735;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- Splits ----------
  // Time cost of hills: roughly +3.5% time per 1% average grade up,
  // -1.8% per 1% grade down (Minetti / Daniels style approximation).
  function computeSplits(course, goalSec) {
    const segs = course.miles.map(m => {
      const upPct = (m.gain || 0) / (m.dist * 5280) * 100;
      const downPct = (m.loss || 0) / (m.dist * 5280) * 100;
      const factor = 1 + 0.035 * upPct - 0.018 * downPct + (m.crowd || 0);
      return { ...m, factor, raw: m.dist * factor };
    });
    const total = segs.reduce((s, x) => s + x.raw, 0);
    const scale = goalSec / total;
    let elapsed = 0;
    return segs.map(s => {
      const split = s.raw * scale;          // seconds for this segment
      const pace = s.factor * scale;        // seconds per mile
      const start = elapsed;
      elapsed += split;
      return { ...s, split, pace, startSec: start, endSec: elapsed };
    });
  }

  // ---------- Weather ----------
  // hourly: { time:[iso...], temperature_2m:[], relative_humidity_2m:[], apparent_temperature:[], dew_point_2m:[], wind_speed_10m:[], cloud_cover:[] }
  function weatherAt(hourly, minutesOfDay) {
    if (!hourly || !hourly.time) return null;
    const h = minutesOfDay / 60;
    const i0 = clamp(Math.floor(h), 0, hourly.time.length - 1);
    const i1 = clamp(i0 + 1, 0, hourly.time.length - 1);
    const f = clamp(h - i0, 0, 1);
    const pick = k => {
      const a = hourly[k] ? hourly[k][i0] : null, b = hourly[k] ? hourly[k][i1] : null;
      if (a == null || b == null) return a ?? b ?? null;
      return a + (b - a) * f;
    };
    return {
      temp: pick('temperature_2m'),
      humidity: pick('relative_humidity_2m'),
      apparent: pick('apparent_temperature'),
      dew: pick('dew_point_2m'),
      wind: pick('wind_speed_10m'),
      cloud: pick('cloud_cover'),
    };
  }

  // ---------- Physiology ----------
  function bmrKcal({ kg, cm, age, sex }) {
    if (!kg || !cm || !age) return null;
    const base = 10 * kg + 6.25 * cm - 5 * age;
    if (sex === 'male') return base + 5;
    if (sex === 'female') return base - 161;
    return base - 78;
  }

  // Estimated sweat rate in L/hr. Base ~0.0115 L/hr per kg at 60F apparent
  // temperature and 9:00/mile, scaled for pace and heat.
  function sweatRate({ kg, paceSec, apparentF, userSweat }) {
    if (userSweat) return userSweat;
    const base = 0.0115 * kg;
    const paceFactor = Math.pow(540 / paceSec, 0.6);
    const t = apparentF == null ? 60 : apparentF;
    const heatFactor = clamp(1 + 0.022 * (t - 60), 0.55, 1.9);
    return base * paceFactor * heatFactor;
  }

  // ---------- Plan ----------
  // inputs: {
  //   course, waveId, arrivalMin (minutes of day), goalSec,
  //   kg, cm, age, sex,
  //   carbsPerHr, gelId, cafGelId|null, saltId|null, useCourseGels, drinkPref ('drink'|'mix'|'water'),
  //   cupOz, userSweat|null, sweatNa (mg/L), caffeineMgPerKg, dailyCaffeine|null,
  //   hourly (weather hourly arrays or null)
  // }
  function buildPlan(inp) {
    const course = inp.course;
    const wave = course.waves.find(w => w.id === inp.waveId) || course.waves[0];
    const [sh, sm] = wave.start.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const splits = computeSplits(course, inp.goalSec);
    const cupMl = inp.cupOz * OZ_ML;
    const gel = P[inp.gelId];
    const cafGel = inp.cafGelId ? P[inp.cafGelId] : null;
    const salt = inp.saltId ? P[inp.saltId] : null;
    const courseDrink = P[course.courseDrink];
    const courseGelPlain = P[course.courseGel.plain];
    const courseGelCaf = P[course.courseGel.caf];
    const stations = Object.fromEntries(course.stations.map(s => [s.mile, s]));

    const warnings = [];
    const carry = {};   // productId -> count
    const addCarry = (id, n = 1) => { carry[id] = (carry[id] || 0) + n; };

    // Cramp history: raises sodium replacement and adds an as-needed kit.
    const crampLevel = inp.cramps === 'often' ? 2 : inp.cramps === 'sometimes' ? 1 : 0;
    const sodiumFactor = crampLevel === 2 ? 0.85 : crampLevel === 1 ? 0.75 : 0.6;
    const crampKit = crampLevel && inp.crampKitId ? P[inp.crampKitId] : null;

    // Caffeine budget
    const cafTotal = inp.caffeineMgPerKg * inp.kg;
    const preRaceCaf = cafTotal > 0 ? Math.round(Math.min(cafTotal * 0.4, 200) / 25) * 25 : 0;
    let cafTaken = 0;
    cafTaken += preRaceCaf; // coffee or caf gel before the start
    const cafStartMile = course.distanceMiles * 0.55;

    // Pre-race gel counts toward first-hour carbs
    const preGel = gel;
    let carbsIn = 0, fluidIn = 0, sodiumIn = 0, kcalIn = 0;
    const tallyFrom = (prod, qty = 1) => {
      carbsIn += prod.carbs * qty; sodiumIn += prod.sodium * qty; kcalIn += (prod.kcal || 0) * qty; cafTaken += prod.caffeine * qty;
    };
    tallyFrom(preGel); addCarry(preGel.id);
    const preRaceFluidMl = 250; // last sip before the start
    fluidIn += preRaceFluidMl;

    // Running state
    let carbsOwed = 0, fluidOwed = 0, sodiumOwed = 0;
    let lastGelSec = -15 * 60; // pre-race gel ~15 min before the gun
    let lastCafMile = -99, lastSaltSec = -9999;
    let sweatTotalL = 0;
    const rows = [];
    let drinkAvailableMissingNote = false;

    for (const seg of splits) {
      const clockMin = startMin + seg.endSec / 60;
      const wx = weatherAt(inp.hourly, clockMin);
      const sweat = sweatRate({ kg: inp.kg, paceSec: seg.pace, apparentF: wx ? wx.apparent : null, userSweat: inp.userSweat });
      const hrs = seg.split / 3600;
      const fluidTargetLhr = clamp(sweat * 0.75, 0.35, 0.9);
      const sodiumTargetHr = clamp(sweat * inp.sweatNa * sodiumFactor, 200, 1000);
      sweatTotalL += sweat * hrs;
      carbsOwed += inp.carbsPerHr * hrs;
      fluidOwed += fluidTargetLhr * 1000 * hrs;
      sodiumOwed += sodiumTargetHr * hrs;

      const st = stations[seg.mile];
      const actions = [];
      let cupsDrink = 0, cupsWater = 0, gelTaken = null, saltTaken = false;

      if (st) {
        // --- Fluids ---
        const deficitMl = fluidOwed - fluidIn;
        let cups = Math.round(deficitMl / cupMl);
        if (cups < 1 && deficitMl > 0.45 * cupMl) cups = 1;
        cups = clamp(cups, 0, 3);
        const carbBalance = carbsIn - carbsOwed; // positive = ahead
        for (let c = 0; c < cups; c++) {
          let useDrink = st.drink && inp.drinkPref !== 'water';
          if (inp.drinkPref === 'mix') useDrink = useDrink && (c % 2 === 0);
          // Don't let the sports drink push carbs far over target.
          if (useDrink && carbBalance + cupsDrink * courseDrink.perOz.carbs * inp.cupOz > 12) useDrink = false;
          if (useDrink) cupsDrink++; else cupsWater++;
        }
        if (cupsDrink) {
          const oz = cupsDrink * inp.cupOz;
          carbsIn += courseDrink.perOz.carbs * oz; sodiumIn += courseDrink.perOz.sodium * oz; kcalIn += courseDrink.perOz.kcal * oz;
          fluidIn += cupsDrink * cupMl;
          actions.push(`${cupsDrink} cup${cupsDrink > 1 ? 's' : ''} ${courseDrink.name.replace(' Formula', '')}`);
        }
        if (cupsWater) {
          fluidIn += cupsWater * cupMl;
          actions.push(`${cupsWater} cup${cupsWater > 1 ? 's' : ''} water`);
        }

        // --- Gel ---
        const carbsNextHr = inp.carbsPerHr * Math.min(1, seg.pace / 3600 * 2); // what accrues over the next ~2 miles
        const deficit = carbsOwed - carbsIn;
        const sinceGel = seg.endSec - lastGelSec;
        const wantCaf = cafTotal > 0 && cafGel && seg.mile >= cafStartMile && (seg.mile - lastCafMile) >= 4 && (cafTaken + 0.5 * cafGel.caffeine) <= cafTotal;
        let candidate = null;
        if (st.gel && inp.useCourseGels) {
          const wantCourseCaf = cafTotal > 0 && seg.mile >= cafStartMile && (seg.mile - lastCafMile) >= 4 && (cafTaken + 0.5 * courseGelCaf.caffeine) <= cafTotal;
          candidate = { prod: wantCourseCaf ? courseGelCaf : courseGelPlain, fromCourse: true };
        } else {
          candidate = { prod: wantCaf ? cafGel : gel, fromCourse: false };
        }
        const gelCarbs = candidate.prod.carbs;
        // Favor the free course depots: be eager at a depot, patient just before one.
        const depotAhead = inp.useCourseGels && course.stations.some(s => s.gel && s.mile > seg.mile && s.mile - seg.mile <= 2);
        const eager = st.gel && inp.useCourseGels ? 0.5 : 0.8;
        let takeGel = (deficit + carbsNextHr >= eager * gelCarbs && sinceGel >= 18 * 60) || deficit >= gelCarbs;
        if (depotAhead && deficit < gelCarbs) takeGel = false;
        if (takeGel && seg.mile <= course.distanceMiles - 1.5) {
          tallyFrom(candidate.prod);
          gelTaken = candidate;
          lastGelSec = seg.endSec;
          if (candidate.prod.caffeine > 0) lastCafMile = seg.mile;
          if (!candidate.fromCourse) addCarry(candidate.prod.id);
          actions.push(`${candidate.prod.name}${candidate.fromCourse ? ' (course depot)' : ''}`);
          if (!cupsWater && !cupsDrink) {
            // Always chase a gel with fluid
            fluidIn += cupMl; cupsWater = 1; actions.push('1 cup water');
          }
        }

        // --- Salt ---
        if (salt) {
          const naDeficit = sodiumOwed - sodiumIn;
          if (naDeficit >= salt.sodium && seg.endSec - lastSaltSec >= 30 * 60) {
            tallyFrom(salt); saltTaken = true; lastSaltSec = seg.endSec; addCarry(salt.id);
            actions.push(`1 ${salt.name}`);
          }
        }
        if (st.banana && actions.length === 0) actions.push('Optional: half banana');
        if (!actions.length) actions.push('Run through');
      }

      const elapsedHrs = seg.endSec / 3600;
      rows.push({
        mile: seg.mile, landmark: seg.landmark, borough: seg.borough,
        gain: seg.gain, loss: seg.loss, pace: seg.pace, split: seg.split,
        elapsedSec: seg.endSec, clockMin,
        wx, sweatLhr: sweat, fluidTargetLhr, sodiumTargetHr,
        station: st || null, actions, cupsDrink, cupsWater, gelTaken, saltTaken,
        carbsIn, carbsRate: carbsIn / elapsedHrs, carbsOwed,
        fluidIn, fluidOwed, sodiumIn, sodiumOwed, cafTaken,
      });
    }

    const finishSec = inp.goalSec;
    const hrs = finishSec / 3600;
    const kcalBurned = Math.round(1.0 * inp.kg * course.distanceMiles * 1.609);
    const bmr = bmrKcal(inp);

    const pre = [];
    // Cramp plan
    let cramp = null;
    if (crampLevel) {
      const kitN = crampLevel === 2 ? 2 : 1;
      if (crampKit) addCarry(crampKit.id, kitN);
      const kitName = crampKit ? crampKit.name.replace(/ \(.*\)/, '') : 'pickle juice or mustard';
      cramp = { steps: [
        `At the first twinge: take one ${kitName}, swish it around your mouth before swallowing, and ease the pace for a minute. Relief usually comes within about 90 seconds and comes from a nerve reflex, not from the salt.`,
        'Keep moving if you can. Stopping dead makes a calf or hamstring cramp lock harder. Shorten your stride instead.',
        'Cramps late in a marathon track pace more than salt. If you are running ahead of your training, the fix is to back off, not to take more capsules.',
        `Sodium target is raised to about ${Math.round(sodiumFactor * 100)}% of estimated sweat loss because of your cramp history.`,
      ] };
      if (!salt) warnings.push('Cramp history noted but no salt capsules selected. Many runners who cramp late do better with one every 45 to 60 minutes in warm conditions.');
      if (crampLevel === 2) pre.push({ offset: -20, text: `Optional: a ${kitName} with your last cup of water. Some frequent crampers find it helps; skip it if vinegar unsettles your stomach.` });
    }

    // Warnings
    if (inp.carbsPerHr >= 90) warnings.push(`Target of ${inp.carbsPerHr} g/hr needs a trained gut. Practice it on long runs or drop to 60 to 75 g/hr.`);
    const avgFluid = (fluidIn - preRaceFluidMl) / hrs;
    if (avgFluid > 900) warnings.push('Planned fluid exceeds about 900 ml/hr, near the limit most guts absorb while running.');
    if (cafTotal > 0 && inp.dailyCaffeine != null && cafTotal > 2 * inp.dailyCaffeine + 50) warnings.push('Race caffeine is well above your usual daily intake. Test this dose in training first.');
    if (inp.caffeineMgPerKg > 5) warnings.push('Caffeine above 5 mg/kg rarely adds benefit and raises side-effect risk.');
    const lastRow = rows[rows.length - 1];
    if (lastRow.carbsRate < inp.carbsPerHr * 0.85) warnings.push(`Plan delivers about ${Math.round(lastRow.carbsRate)} g/hr against a ${inp.carbsPerHr} g/hr target. Carry one extra gel as a buffer.`);
    if (sodiumIn < 0.6 * sodiumOwed) warnings.push(`Sodium lands around ${Math.round(sodiumIn / hrs)} mg/hr, under the ${Math.round(sodiumOwed / hrs)} mg/hr estimate. Add salt capsules, pick a higher-sodium gel, or take more sports drink.`);
    if (inp.useCourseGels) warnings.push('Course gel depots run out. Carry one spare in case miles 12 or 18 are empty when you pass.');
    if (!inp.hourly) warnings.push('No weather loaded. Sweat and fluid targets assume a mild 60°F day.');

    // Pre-race timeline (minutes relative to start, negative = before)
    const carbsBreakfast = Math.round(1.5 * inp.kg);
    pre.push({ offset: -180, text: `Breakfast: about ${carbsBreakfast} g carbs (bagel with jam plus a banana, or oatmeal). 400 to 600 ml fluid. Low fiber, low fat.` });
    pre.push({ offset: -120, text: `Sip 300 to 500 ml water or ${courseDrink.name}. Stop forcing fluid after this.` });
    if (preRaceCaf > 0) pre.push({ offset: -60, text: `Caffeine: about ${preRaceCaf} mg (a 12 oz coffee is roughly 150 mg, or a caffeinated gel).` });
    pre.push({ offset: -30, text: 'Final toilet stop. Nothing new from here.' });
    pre.push({ offset: -15, text: `Take 1 ${preGel.name} with ${preRaceFluidMl} ml (a cup) of water.` });

    return {
      course, wave, startMin, arrivalMin: inp.arrivalMin,
      rows, pre, carry, warnings, cramp,
      totals: {
        finishSec, finishClockMin: startMin + finishSec / 60,
        carbsIn: Math.round(carbsIn), carbsPerHr: Math.round(carbsIn / hrs),
        fluidMl: Math.round(fluidIn), fluidPerHr: Math.round(avgFluid),
        sodiumMg: Math.round(sodiumIn), sodiumPerHr: Math.round(sodiumIn / hrs),
        caffeineMg: Math.round(cafTaken), preRaceCaf,
        kcalIn: Math.round(kcalIn), kcalBurned, bmr: bmr ? Math.round(bmr) : null,
        sweatTotalL: Math.round(sweatTotalL * 100) / 100,
        gelsCarried: Object.entries(carry).filter(([id]) => P[id].type === 'gel' || P[id].type === 'chew').reduce((s, [, n]) => s + n, 0),
      },
    };
  }

  window.Planner = { buildPlan, computeSplits, weatherAt, sweatRate, bmrKcal };
})();
