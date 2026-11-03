// Post-race review engine: parse actual splits, tally what was actually taken,
// compare with the plan, and propose inputs for next time. No DOM access.
(function () {
  const P = window.PRODUCT_BY_ID;
  const OZ_ML = 29.5735;
  const MI_M = 1609.344;

  // ---------- splits ----------
  const toSec = t => {
    const parts = String(t).trim().split(':').map(Number);
    if (parts.some(isNaN) || !parts.length) return null;
    return parts.reduce((s, v) => s * 60 + v, 0);
  };

  // Text: one time per line or comma separated; mm:ss per mile, or cumulative
  // h:mm:ss. Returns segment seconds for the course's segments, or null.
  function parseSplitsText(text, course) {
    const vals = text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(toSec);
    if (!vals.length || vals.some(v => v == null)) return null;
    const n = course.miles.length; // 27 for a marathon (26 + 0.2)
    let segs;
    const increasing = vals.every((v, i) => i === 0 || v > vals[i - 1]);
    if (increasing && vals[vals.length - 1] > 90 * 60) {
      segs = vals.map((v, i) => v - (i ? vals[i - 1] : 0));
    } else segs = vals.slice();
    if (segs.length === n - 1) {
      const avg = segs.reduce((a, b) => a + b, 0) / (n - 1);
      segs.push(avg * course.miles[n - 1].dist);
    }
    if (segs.length !== n) return null;
    return segs;
  }

  function fromFinishTime(finishSec, plan) {
    const planTotal = plan.rows[plan.rows.length - 1].elapsedSec;
    return plan.rows.map(r => r.split * finishSec / planTotal);
  }

  // Points: [{d: meters cumulative, t: seconds since start}] -> segment seconds.
  function segmentsFromTrack(points, course) {
    if (points.length < 10) return null;
    const total = points[points.length - 1].d;
    const target = course.distanceMiles * MI_M;
    const scale = target / total;
    if (scale < 0.9 || scale > 1.12) return null; // not a full marathon track
    let cum = 0, idx = 0, prevT = 0;
    const segs = [];
    for (const m of course.miles) {
      cum += m.dist * MI_M / scale;
      while (idx < points.length - 1 && points[idx + 1].d < cum) idx++;
      const a = points[idx], b = points[Math.min(idx + 1, points.length - 1)];
      const f = b.d > a.d ? (cum - a.d) / (b.d - a.d) : 0;
      const t = a.t + (b.t - a.t) * Math.max(0, Math.min(1, f));
      segs.push(t - prevT); prevT = t;
    }
    return segs;
  }

  const hav = (la1, lo1, la2, lo2) => {
    const R = 6371000, r = Math.PI / 180;
    const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  function parseGpx(xml, course) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const pts = [...doc.getElementsByTagName('trkpt')];
    if (!pts.length) return null;
    let d = 0, t0 = null, prev = null;
    const out = [];
    for (const p of pts) {
      const la = +p.getAttribute('lat'), lo = +p.getAttribute('lon');
      const te = p.getElementsByTagName('time')[0];
      if (!te) continue;
      const t = Date.parse(te.textContent) / 1000;
      if (t0 == null) t0 = t;
      if (prev) d += hav(prev[0], prev[1], la, lo);
      prev = [la, lo];
      out.push({ d, t: t - t0 });
    }
    return segmentsFromTrack(out, course);
  }

  function parseTcx(xml, course) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const pts = [...doc.getElementsByTagName('Trackpoint')];
    if (!pts.length) return null;
    let t0 = null;
    const out = [];
    for (const p of pts) {
      const de = p.getElementsByTagName('DistanceMeters')[0], te = p.getElementsByTagName('Time')[0];
      if (!de || !te) continue;
      const t = Date.parse(te.textContent) / 1000;
      if (t0 == null) t0 = t;
      out.push({ d: +de.textContent, t: t - t0 });
    }
    return segmentsFromTrack(out, course);
  }

  // Known cumulative times at some mile markers -> segment seconds for every
  // course segment. Gaps (miles without a mat) are filled in proportion to the
  // plan's split for those miles, so hills still shape the estimate.
  function splitsFromMarkers(markers, plan) {
    const course = plan.course;
    const pts = Object.entries(markers).map(([m, t]) => [+m, t]).filter(([m, t]) => t > 0 && m > 0 && m <= course.distanceMiles).sort((a, b) => a[0] - b[0]);
    if (!pts.length) return null;
    if (pts[pts.length - 1][0] < course.distanceMiles) return null; // need a finish time
    const segs = new Array(plan.rows.length).fill(0);
    let prevMile = 0, prevT = 0;
    for (const [m, t] of pts) {
      const idx = plan.rows.map((r, i) => (r.mile > prevMile + 1e-9 && r.mile <= m + 1e-9) ? i : -1).filter(i => i >= 0);
      const w = idx.reduce((s, i) => s + plan.rows[i].split, 0);
      for (const i of idx) segs[i] = (t - prevT) * plan.rows[i].split / w;
      prevMile = m; prevT = t;
    }
    return segs;
  }

  // NYRR public results API (the same one results.nyrr.org uses). Returns
  // { name, bib, netTime, markers } or throws with a readable message.
  async function fetchNyrr(bib, eventCode) {
    const api = 'https://rmsprodapi.nyrr.org/api/v2/runners';
    const post = (path, body) => fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body: JSON.stringify(body) }).then(r => { if (!r.ok) throw new Error('NYRR results returned ' + r.status); return r.json(); });
    const list = await post('/finishers-filter', { eventCode, pageIndex: 1, pageSize: 50, searchString: String(bib).trim(), sortColumn: 'overallTime', sortDescending: false });
    const hit = (list.items || []).find(x => String(x.bib) === String(bib).trim());
    if (!hit) throw new Error(`No finisher with bib ${bib} in ${eventCode}.`);
    const det = await post('/resultDetails', { eventCode, runnerId: hit.runnerId });
    const d = det.details || {};
    const markers = {};
    for (const sp of d.splitResults || []) {
      const mm = /^(\d+)M$/.exec(sp.splitCode || '');
      if (mm) markers[+mm[1]] = toSec(sp.time);
      else if (sp.splitCode === 'MAR') markers[26.2] = toSec(sp.time);
    }
    const net = toSec(d.netTime || hit.overallTime);
    if (net && !markers[26.2]) markers[26.2] = net;
    return { name: `${hit.firstName} ${hit.lastName}`, bib: hit.bib, netTime: net, markers, place: hit.overallPlace };
  }

  // ---------- defaults from plan ----------
  function logFromPlan(plan) {
    return plan.rows.map(r => ({
      mile: r.mile, drink: r.cupsDrink, water: r.cupsWater,
      gel: r.gelTaken ? r.gelTaken.prod.id : '', salt: !!r.saltTaken, banana: false,
    }));
  }

  // ---------- analysis ----------
  // args: { plan, inp, splits (seg seconds|null), log, feel:[{mile,energy,stomach,cramp}], preKg, postKg }
  function analyze(a) {
    const { plan, inp } = a;
    const course = plan.course;
    const splits = a.splits || plan.rows.map(r => r.split);
    const cupMl = inp.cupOz * OZ_ML;
    const drink = P[course.courseDrink];
    const findings = [];
    const add = (level, text) => findings.push({ level, text });

    // Per-mile actual tallies
    let elapsed = 0, carbs = 0, fluid = 0, sodium = 0, caf = 0;
    const intakes = []; // {sec, carbs}
    const rows = plan.rows.map((r, i) => {
      const l = a.log[i] || { drink: 0, water: 0, gel: '', salt: false, banana: false };
      const split = splits[i];
      elapsed += split;
      let c = 0, s = 0, k = 0;
      const oz = (l.drink || 0) * inp.cupOz;
      c += drink.perOz.carbs * oz; s += drink.perOz.sodium * oz;
      fluid += ((l.drink || 0) + (l.water || 0)) * cupMl;
      if (l.gel && P[l.gel]) { c += P[l.gel].carbs; s += P[l.gel].sodium; k += P[l.gel].caffeine; }
      if (l.salt && inp.saltId && P[inp.saltId]) s += P[inp.saltId].sodium;
      if (l.banana) c += P.banana.carbs;
      carbs += c; sodium += s; caf += k;
      if (c > 5) intakes.push({ sec: elapsed, carbs: c, mile: r.mile });
      const dist = course.miles[i].dist;
      return { mile: r.mile, split, pace: split / dist, planPace: r.pace, elapsed, planElapsed: r.elapsedSec, carbs, fluid, sodium, caf, mileCarbs: c };
    });
    const finishSec = elapsed;
    const hrs = finishSec / 3600;

    // Hourly comparison. Plan values interpolated by plan elapsed time; actual by actual elapsed.
    const at = (arr, key, timeKey, sec) => {
      let prev = { [key]: 0, [timeKey]: 0 };
      for (const r of arr) {
        if (r[timeKey] >= sec) {
          const f = (sec - prev[timeKey]) / (r[timeKey] - prev[timeKey] || 1);
          return prev[key] + (r[key] - prev[key]) * f;
        }
        prev = r;
      }
      return arr[arr.length - 1][key];
    };
    const nH = Math.ceil(hrs);
    const hours = [];
    for (let h = 1; h <= nH; h++) {
      const s0 = (h - 1) * 3600, s1 = Math.min(h * 3600, finishSec);
      const frac = (s1 - s0) / 3600;
      if (frac < 0.2) continue; // ignore a sliver of a final hour
      const planRows = plan.rows;
      const rowFor = (key, tk, src) => at(src, key, tk, s1) - at(src, key, tk, s0);
      hours.push({
        hour: h, frac,
        carbsPlan: rowFor('carbsIn', 'elapsedSec', planRows) / frac, carbsActual: rowFor('carbs', 'elapsed', rows) / frac,
        fluidPlan: rowFor('fluidIn', 'elapsedSec', planRows) / frac, fluidActual: rowFor('fluid', 'elapsed', rows) / frac,
        sodiumPlan: rowFor('sodiumIn', 'elapsedSec', planRows) / frac, sodiumActual: rowFor('sodium', 'elapsed', rows) / frac,
      });
    }
    // The plan's hour 1 includes the pre-start gel; actual in-race log does not. Add it to actual hour 1 for a fair comparison.
    const preGel = P[inp.gelId];
    if (hours.length) hours[0].carbsActual += preGel.carbs / hours[0].frac;
    const carbsTotal = carbs + preGel.carbs;
    const carbsRate = carbsTotal / hrs;
    const fluidRate = fluid / hrs;

    // ---- Fueling findings ----
    const fullHours = hours.filter(h => h.frac > 0.5);
    const under = fullHours.filter(h => h.carbsActual < 0.75 * inp.carbsPerHr);
    if (!under.length) add('good', `Carbs averaged ${Math.round(carbsRate)} g/hr against a ${inp.carbsPerHr} g/hr target, and no hour fell below three quarters of target.`);
    else add('warn', `Carbs averaged ${Math.round(carbsRate)} g/hr (target ${inp.carbsPerHr}). Under target in hour${under.length > 1 ? 's' : ''} ${under.map(h => `${h.hour} (${Math.round(h.carbsActual)} g/hr)`).join(', ')}.`);
    let maxGap = 0, gapAt = null, prevSec = 0, prevMile = 'start';
    for (const it of intakes) { const g = it.sec - prevSec; if (g > maxGap) { maxGap = g; gapAt = [prevMile, it.mile]; } prevSec = it.sec; prevMile = it.mile; }
    const tailGap = finishSec - prevSec; if (tailGap > maxGap) { maxGap = tailGap; gapAt = [prevMile, 'finish']; }
    if (maxGap > 40 * 60) add('warn', `Longest stretch without meaningful carbs was ${Math.round(maxGap / 60)} min, from mile ${gapAt[0]} to ${gapAt[1]}. Aim to keep every gap under 30 min.`);

    // ---- Fluid findings ----
    const planFluidRate = plan.totals.fluidPerHr;
    if (fluidRate < 0.7 * planFluidRate) add('warn', `Fluid came in at ${Math.round(fluidRate)} ml/hr versus ${planFluidRate} planned. Grab the cup even when you do not feel thirsty, especially in the second half.`);
    else if (fluidRate > 1.3 * planFluidRate) add('warn', `Fluid was ${Math.round(fluidRate)} ml/hr, well above the ${planFluidRate} planned. Fine if your stomach was calm; otherwise it is a sloshing risk.`);
    else add('good', `Fluid intake of ${Math.round(fluidRate)} ml/hr was close to the ${planFluidRate} ml/hr plan.`);
    let sweat = null;
    if (a.preKg && a.postKg) {
      const lossKg = a.preKg - a.postKg;
      const sweatL = lossKg + fluid / 1000;
      sweat = { lossKg, pct: lossKg / a.preKg * 100, sweatL, rate: sweatL / hrs };
      if (sweat.pct > 3) add('bad', `You finished ${sweat.pct.toFixed(1)}% lighter. Measured sweat rate was about ${sweat.rate.toFixed(2)} L/hr; drinking more in the warm hours would have cut the loss.`);
      else if (sweat.pct < 0.3) add('warn', `Body mass barely changed (${sweat.pct.toFixed(1)}%), which suggests drinking at or above sweat rate. That is a low-sodium risk on long days; drink a little less next time.`);
      else add('good', `Body mass dropped ${sweat.pct.toFixed(1)}%, inside the 1 to 3% band that goes with good performance. Measured sweat rate about ${sweat.rate.toFixed(2)} L/hr.`);
    }

    // ---- Sodium ----
    const sodiumRate = sodium / hrs;
    if (sodiumRate < 0.6 * plan.totals.sodiumPerHr) add('warn', `Sodium landed at ${Math.round(sodiumRate)} mg/hr against ${plan.totals.sodiumPerHr} planned.`);

    // ---- Pace ----
    const planFinish = plan.rows[plan.rows.length - 1].elapsedSec;
    const diff = finishSec - planFinish;
    const halfActual = rows.filter(r => r.mile <= 13).reduce((s, r) => s + r.split, 0);
    const halfPlan = plan.rows.filter(r => r.mile <= 13).reduce((s, r) => s + r.split, 0);
    const earlyPace = rows.filter(r => r.mile >= 3 && r.mile <= 20).reduce((s, r) => s + r.pace, 0) / 18;
    const latePace = rows.filter(r => r.mile >= 21).reduce((s, r) => s + r.pace, 0) / rows.filter(r => r.mile >= 21).length;
    const fadePct = (latePace / earlyPace - 1) * 100;
    // Fade is judged against the runner's own early pace (miles 3 to 13), not the plan,
    // so a runner who simply had a slower day is not flagged from mile 14 onward.
    const ownEarly = rows.filter(r => r.mile >= 3 && r.mile <= 13).reduce((s, r) => s + r.pace, 0) / 11;
    let fadeStart = null;
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].mile >= 14 && rows[i].pace > ownEarly * 1.08 && rows[i + 1].pace > ownEarly * 1.08) { fadeStart = rows[i].mile; break; }
    }
    const secondHalf = finishSec - halfActual;
    const wentOutFast = secondHalf > halfActual * 1.06 || (halfActual < halfPlan * 0.98 && secondHalf > halfActual * 1.03);
    if (fadePct > 8) {
      let why;
      if (fadeStart) {
        const winStart = rows.find(r => r.mile === fadeStart).elapsed - 3600;
        const carbsBefore = intakes.filter(it => it.sec > winStart && it.sec <= rows.find(r => r.mile === fadeStart).elapsed).reduce((s, it) => s + it.carbs, 0);
        if (carbsBefore < 0.7 * inp.carbsPerHr) why = `Only ${Math.round(carbsBefore)} g of carbs went in during the hour before the fade, so fueling is the first suspect.`;
        else if (wentOutFast) why = `Fueling before the fade was on target (${Math.round(carbsBefore)} g in the prior hour), but the second half took ${fmt(secondHalf - halfActual)} longer than the first. Pacing, not fuel, is the likely cause.`;
        else why = `Fueling before the fade was on target (${Math.round(carbsBefore)} g in the prior hour) and pacing was sensible, so look at heat, training, or the course.`;
      } else why = wentOutFast ? 'The second half was much slower than the first, which points to pacing.' : '';
      add(fadeStart && !wentOutFast ? 'warn' : 'bad', `Pace faded ${fadePct.toFixed(0)}% over the last 10K${fadeStart ? `, starting around mile ${fadeStart}` : ''}. ${why}`);
    } else if (fadePct > 3) add('warn', `Mild fade of ${fadePct.toFixed(0)}% over the last 10K, normal for a marathon.`);
    else add('good', `Even pacing: the last 10K was within ${Math.abs(fadePct).toFixed(0)}% of your earlier pace.`);
    add(Math.abs(diff) < 300 ? 'good' : 'info', `Finished in ${fmt(finishSec)}, ${diff >= 0 ? fmt(diff) + ' slower' : fmt(-diff) + ' faster'} than the ${fmt(planFinish)} plan.`);

    // ---- Feel ----
    const stomachBad = (a.feel || []).filter(f => f.stomach && f.stomach <= 2);
    const energyBad = (a.feel || []).filter(f => f.energy && f.energy <= 2);
    const cramped = (a.feel || []).filter(f => f.cramp);
    let suggestCarbs = inp.carbsPerHr, suggestDrink = inp.drinkPref;
    const notes = [];
    if (stomachBad.length) {
      const m = stomachBad[0].mile;
      const row = rows.find(r => r.mile === m) || rows[rows.length - 1];
      const prevHourCarbs = intakes.filter(it => it.sec > row.elapsed - 3600 && it.sec <= row.elapsed).reduce((s, it) => s + it.carbs, 0);
      const drinkCarbs = rows.reduce((s, r, i) => s + drink.perOz.carbs * (a.log[i]?.drink || 0) * inp.cupOz, 0);
      add('bad', `Stomach trouble reported around mile ${m}, after about ${Math.round(prevHourCarbs)} g of carbs in the previous hour.`);
      if (prevHourCarbs >= 0.9 * inp.carbsPerHr) { suggestCarbs = Math.max(45, inp.carbsPerHr - 15); notes.push(`Drop the carb target to ${suggestCarbs} g/hr and train the gut back up over the next block.`); }
      if (drinkCarbs > 0.3 * carbsTotal && inp.drinkPref !== 'water') { suggestDrink = 'water'; notes.push('Take water at stations and get carbs from gels only; sports drink on top of gels is a common stomach trigger.'); }
    }
    if (energyBad.length && !stomachBad.length) {
      const m = energyBad[0].mile;
      const row = rows.find(r => r.mile === m) || rows[rows.length - 1];
      const prevHourCarbs = intakes.filter(it => it.sec > row.elapsed - 3600 && it.sec <= row.elapsed).reduce((s, it) => s + it.carbs, 0);
      if (prevHourCarbs < 0.8 * inp.carbsPerHr) { add('warn', `Low energy around mile ${m} followed an hour with only ${Math.round(prevHourCarbs)} g of carbs.`); notes.push('Keep the same target but carry one spare gel and set a watch alert every 25 minutes.'); }
      else add('info', `Low energy around mile ${m} despite fueling near target; this points to pacing or fitness rather than fuel.`);
    }
    if (cramped.length) {
      add('warn', `Cramping reported around mile ${cramped[0].mile}. Sodium was ${Math.round(sodiumRate)} mg/hr${wentOutFast ? ' and the first half was faster than planned, which is the stronger cramp predictor' : ''}.`);
      if (inp.cramps === 'never') notes.push('Set cramp history to "Sometimes" so the planner raises sodium and packs a cramp kit.');
    }
    if (!stomachBad.length && !under.length && inp.carbsPerHr < 90 && !energyBad.length) notes.push(`Fueling went well. If you want more, train toward ${inp.carbsPerHr + 15} g/hr on long runs before raising the race target.`);
    if (wentOutFast) notes.push(`Positive split: the second half took ${fmt(secondHalf - halfActual)} longer than the first. Start nearer ${fmt(Math.round(finishSec / 60) * 60)} pace and hold it through halfway.`);

    const suggestions = {
      userSweat: sweat ? Math.round(sweat.rate * 20) / 20 : null,
      carbsPerHr: suggestCarbs, drinkPref: suggestDrink,
      cramps: cramped.length && inp.cramps === 'never' ? 'sometimes' : null,
      goalSec: wentOutFast ? Math.round(finishSec / 60) * 60 : null,
      notes,
    };

    return {
      rows, hours, finishSec, planFinish, sweat, findings, suggestions,
      totals: { carbs: Math.round(carbsTotal), carbsRate: Math.round(carbsRate), fluid: Math.round(fluid), fluidRate: Math.round(fluidRate), sodium: Math.round(sodium), sodiumRate: Math.round(sodiumRate), caffeine: Math.round(caf + plan.totals.preRaceCaf), fadePct },
    };
  }

  function fmt(sec) {
    sec = Math.round(Math.abs(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  window.Review = { parseSplitsText, fromFinishTime, parseGpx, parseTcx, splitsFromMarkers, fetchNyrr, logFromPlan, analyze };
})();
