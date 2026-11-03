// UI wiring: reads the form, fetches weather, renders the plan.
(function () {
  const $ = id => document.getElementById(id);
  const P = window.PRODUCT_BY_ID;
  const courses = window.COURSES;
  let hourly = null;        // fetched hourly weather
  let hourlyDate = null;

  // ---------- helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const fmtClock = min => {
    let m = Math.round(min); let h = Math.floor(m / 60) % 24; m = m % 60;
    const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return `${h}:${pad(m)} ${ap}`;
  };
  const fmtDur = sec => {
    sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };
  const fmtPace = sec => { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${pad(s)}/mi`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- populate selects ----------
  function fillProducts() {
    const gels = window.PRODUCTS.filter(p => (p.type === 'gel' || p.type === 'chew') && p.caffeine === 0);
    const cafs = window.PRODUCTS.filter(p => p.type === 'gel' && p.caffeine > 0);
    const salts = window.PRODUCTS.filter(p => p.type === 'salt');
    $('gel').innerHTML = gels.map(p => `<option value="${p.id}">${esc(p.name)} (${p.carbs} g)</option>`).join('');
    $('cafGel').innerHTML = '<option value="">None</option>' + cafs.map(p => `<option value="${p.id}">${esc(p.name)} (${p.carbs} g, ${p.caffeine} mg)</option>`).join('');
    $('salt').innerHTML = '<option value="">None</option>' + salts.map(p => `<option value="${p.id}">${esc(p.name)} (${p.sodium} mg Na)</option>`).join('');
    $('gel').value = 'maurten-100'; $('cafGel').value = 'maurten-caf100';
  }
  function fillCourses() {
    $('course').innerHTML = Object.values(courses).map(c => `<option value="${c.id}">${esc(c.name)} ${c.year}</option>`).join('');
    onCourseChange();
  }
  function onCourseChange() {
    const c = courses[$('course').value];
    $('wave').innerHTML = c.waves.map(w => `<option value="${w.id}">${esc(w.label)} · ${fmtClock(toMin(w.start))}</option>`).join('');
    $('wave').value = c.defaultWave;
    $('date').value = c.date;
    $('villageNote').textContent = c.startVillageNotes;
    $('sources').innerHTML = c.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(', ');
    onWaveChange();
  }
  function onWaveChange() {
    const c = courses[$('course').value];
    const w = c.waves.find(w => w.id === $('wave').value);
    const arr = toMin(w.start) - 150;
    $('arrival').value = `${pad(Math.floor(arr / 60))}:${pad(arr % 60)}`;
  }
  const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

  // ---------- weather ----------
  async function fetchWeather() {
    const c = courses[$('course').value];
    const date = $('date').value;
    if (!date) return;
    $('wxStatus').textContent = 'Loading…';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(date + 'T00:00:00');
    const daysAgo = (today - d) / 86400000;
    const base = daysAgo > 7 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${base}?latitude=${c.lat}&longitude=${c.lon}&start_date=${date}&end_date=${date}` +
      `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,wind_speed_10m,cloud_cover,precipitation` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(c.timezone)}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.hourly || !j.hourly.time || j.hourly.temperature_2m.every(v => v == null)) throw new Error('no data for that date');
      hourly = j.hourly; hourlyDate = date;
      const t = j.hourly.temperature_2m, i9 = 9, i13 = 13;
      $('wxStatus').textContent = `Loaded ${date}: ${Math.round(t[i9])}°F at 9 am, ${Math.round(t[i13])}°F at 1 pm, humidity ${j.hourly.relative_humidity_2m[i9]}% → ${j.hourly.relative_humidity_2m[i13]}%`;
      $('wxManual').checked = false;
      build();
    } catch (e) {
      hourly = null; hourlyDate = null;
      $('wxStatus').textContent = 'Could not load weather (' + e.message + '). Use manual values.';
      $('wxManual').checked = true;
    }
  }
  function manualHourly() {
    const n = 24, t = +$('wxTemp').value, h = +$('wxHum').value, w = +$('wxWind').value;
    // Apparent temperature: simple humidity/wind adjustment around the dry-bulb value.
    const app = t + (h - 50) * 0.08 - w * 0.3;
    return {
      time: Array.from({ length: n }, (_, i) => `${pad(i)}:00`),
      temperature_2m: Array(n).fill(t), relative_humidity_2m: Array(n).fill(h),
      apparent_temperature: Array(n).fill(app), dew_point_2m: Array(n).fill(null), wind_speed_10m: Array(n).fill(w), cloud_cover: Array(n).fill(null),
    };
  }

  // ---------- inputs ----------
  function readInputs() {
    const course = courses[$('course').value];
    const wLb = $('weightUnit').value === 'lb';
    const kg = wLb ? +$('weight').value * 0.4536 : +$('weight').value;
    const cm = $('heightUnit').value === 'in' ? +$('height').value * 2.54 : +$('height').value;
    const goalSec = (+$('goalH').value) * 3600 + (+$('goalM').value) * 60 + (+$('goalS').value);
    const wx = $('wxManual').checked ? manualHourly() : hourly;
    return {
      course, waveId: $('wave').value, arrivalMin: toMin($('arrival').value || '07:00'), goalSec,
      kg, cm, age: +$('age').value || null, sex: $('sex').value || null,
      carbsPerHr: +$('carbs').value, gelId: $('gel').value, cafGelId: $('cafGel').value || null, saltId: $('salt').value || null,
      useCourseGels: $('useCourseGels').checked, drinkPref: $('drinkPref').value, cupOz: +$('cupOz').value || 4,
      userSweat: +$('sweat').value || null, sweatNa: +$('sweatNa').value || 900,
      caffeineMgPerKg: +$('caffeine').value, dailyCaffeine: $('dailyCaf').value === '' ? null : +$('dailyCaf').value,
      cramps: $('cramps').value, crampKitId: $('crampKit').value || null,
      hourly: wx,
    };
  }

  // ---------- render ----------
  function build() {
    const inp = readInputs();
    if (!inp.goalSec || inp.goalSec < 3600) { $('buildStatus').textContent = 'Enter a goal finish time.'; return; }
    const plan = window.Planner.buildPlan(inp);
    renderSummary(plan, inp);
    renderPre(plan);
    renderCramp(plan);
    renderRows(plan);
    renderCards(plan);
    $('courseNotes').innerHTML = plan.course.notes.map(n => `<li>${esc(n)}</li>`).join('');
    $('warnings').hidden = !plan.warnings.length;
    $('warnings').innerHTML = plan.warnings.length ? '<strong>Check these</strong><ul>' + plan.warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>' : '';
    $('output').hidden = false;
    $('buildStatus').textContent = `Plan built for ${plan.wave.label} start at ${fmtClock(plan.startMin)}, finish about ${fmtClock(plan.totals.finishClockMin)}.`;
    buildWeek(plan);
    currentPlan = plan; currentInp = inp;
    renderReview();
  }

  function buildWeek(plan) {
    const carry = Object.entries(plan.carry).map(([id, n]) => `${n} × ${P[id].name}`).join(', ');
    const w = window.Week.buildWeek({
      course: plan.course, kg: readInputs().kg, carbLoad: $('carbLoad').value, diet: $('diet').value, cafTaper: $('cafTaper').value,
      lastRun: $('lastRun').value, sweatNa: +$('sweatNa').value || 900, caffeineMgPerKg: +$('caffeine').value,
      dailyCaffeine: $('dailyCaf').value === '' ? null : +$('dailyCaf').value, cramps: $('cramps').value, carry,
    });
    renderWeek(w, plan);
    $('weekOutput').hidden = false;
  }

  function renderWeek(w, plan) {
    const s = w.summary;
    $('weekSummary').innerHTML = `
      <div class="stat"><div class="k">Carb load</div><div class="v">${s.loadCarbs} g/day</div><div class="s">${s.loadGkg} g/kg for ${s.loadDays} day${s.loadDays > 1 ? 's' : ''} · ${s.loadTotal} g over the load</div></div>
      <div class="stat"><div class="k">Protein</div><div class="v">${s.protein} g/day</div><div class="s">About 1.6 g/kg, spread across meals</div></div>
      <div class="stat"><div class="k">Race-eve sodium</div><div class="v">${s.saltySweater ? '2 to 3 g' : '1 to 2 g'}</div><div class="s">Extra, on top of normal food</div></div>
      <div class="stat"><div class="k">Bib pickup</div><div class="s" style="font-size:13px">${esc(s.expo)}</div></div>`;
    $('weekWarnings').hidden = !w.warnings.length;
    $('weekWarnings').innerHTML = w.warnings.length ? '<strong>Check these</strong><ul>' + w.warnings.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '';
    const raceDay = `<div class="day race"><div class="head"><strong>Race day · ${esc(plan.course.name)} ${plan.course.year}</strong><span class="muted">${plan.wave.label} start ${fmtClock(plan.startMin)}</span></div>
      <ul><li>Breakfast, village fueling and the mile-by-mile plan are on the Race day tab.</li><li>Wake 3 to 3.5 hours before your wave so breakfast has time to clear.</li></ul></div>`;
    $('weekDays').innerHTML = w.days.map(d => `
      <div class="day ${d.isLoad ? 'load' : ''}">
        <div class="head"><strong>${d.weekday} · ${d.dateLabel}</strong><span class="muted">${d.daysOut} day${d.daysOut > 1 ? 's' : ''} out${d.isLoad ? ' · carb load' : ''}</span></div>
        <div class="targets">
          <span>Carbs <b>${d.carbs} g</b> (${d.gkg} g/kg)</span>
          <span>Protein <b>${d.protein} g</b></span>
          <span>Fluid <b>${(d.fluidMl / 1000).toFixed(1)} L</b> plus thirst</span>
          <span>Fiber: ${esc(d.fiber)}</span>
          <span>Caffeine: ${esc(d.caffeine)}</span>
        </div>
        <div class="where muted">${esc(d.run)}</div>
        <ul>${d.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        ${d.meals ? `<div class="meals"><strong>Sample day:</strong> ${d.meals.map(esc).join(' · ')}</div>` : ''}
      </div>`).join('') + raceDay;
    $('carbExamples').innerHTML = w.examples.map(e => `<tr><td>${e.carbs} g</td><td class="wrap-ok">${esc(e.name)}</td></tr>`).join('');
  }

  function renderSummary(plan, inp) {
    const t = plan.totals;
    const carryList = Object.entries(plan.carry).map(([id, n]) => `<li>${n} × ${esc(P[id].name)}</li>`).join('');
    const kcalNote = t.bmr ? `Resting burn about ${t.bmr} kcal/day` : 'Add height, age and sex for resting-energy estimate';
    $('summary').innerHTML = `
      <div class="stat"><div class="k">Carry</div><ul>${carryList}</ul><div class="s">Includes the pre-start gel. Course depots not counted.</div></div>
      <div class="stat"><div class="k">Carbs</div><div class="v">${t.carbsPerHr} g/hr</div><div class="s">${t.carbsIn} g total vs ${inp.carbsPerHr} g/hr target</div></div>
      <div class="stat"><div class="k">Fluid</div><div class="v">${t.fluidPerHr} ml/hr</div><div class="s">${(t.fluidMl / 1000).toFixed(2)} L total · est. sweat loss ${t.sweatTotalL} L</div></div>
      <div class="stat"><div class="k">Sodium</div><div class="v">${t.sodiumPerHr} mg/hr</div><div class="s">${t.sodiumMg} mg total</div></div>
      <div class="stat"><div class="k">Caffeine</div><div class="v">${t.caffeineMg} mg</div><div class="s">${t.preRaceCaf} mg before the start · ${(t.caffeineMg / inp.kg).toFixed(1)} mg/kg</div></div>
      <div class="stat"><div class="k">Energy</div><div class="v">${t.kcalIn} / ${t.kcalBurned} kcal</div><div class="s">Taken in vs burned (about 1 kcal per kg per km). ${kcalNote}</div></div>
      <div class="stat"><div class="k">Timing</div><div class="v">${fmtClock(plan.startMin)} → ${fmtClock(t.finishClockMin)}</div><div class="s">${plan.wave.label}, goal ${fmtDur(t.finishSec)}</div></div>`;
  }

  function renderCramp(plan) {
    const c = plan.cramp;
    $('crampCard').hidden = !c;
    if (!c) return;
    $('crampCard').innerHTML = `<h2>If a cramp starts</h2><ul style="margin:0;padding-left:18px">${c.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }

  function renderPre(plan) {
    const rows = [{ offset: plan.arrivalMin - plan.startMin, text: 'Arrive at the start village. Keep warm, keep sipping, stay off your feet.' }, ...plan.pre]
      .sort((a, b) => a.offset - b.offset);
    $('preBody').innerHTML = rows.map(r => `<tr><td>${fmtClock(plan.startMin + r.offset)}</td><td class="wrap-ok">${esc(r.text)} <span class="muted">(${Math.abs(Math.round(r.offset))} min before)</span></td></tr>`).join('') +
      `<tr><td>${fmtClock(plan.startMin)}</td><td class="wrap-ok"><strong>Start.</strong> First aid station is at mile 3.</td></tr>`;
  }

  function renderRows(plan) {
    $('planBody').innerHTML = plan.rows.map(r => {
      const hill = r.gain >= 60 ? ' ▲' : r.loss >= 60 ? ' ▼' : '';
      const wx = r.wx && r.wx.temp != null ? `${Math.round(r.wx.temp)}°F · ${Math.round(r.wx.humidity)}%${r.wx.apparent != null ? ` · feels ${Math.round(r.wx.apparent)}°` : ''}` : '<span class="muted">—</span>';
      const st = r.station ? [
        r.station.drink ? '<span class="tag drink">Gatorade</span>' : '',
        r.station.water ? '<span class="tag water">Water</span>' : '',
        r.station.gel ? '<span class="tag gel">Gel depot</span>' : '',
        r.station.refill ? '<span class="tag">Refill</span>' : '',
        r.station.banana ? '<span class="tag">Banana</span>' : '',
      ].join('') : '<span class="muted">—</span>';
      const cls = [r.station ? 'station' : '', r.gelTaken ? 'gel' : ''].join(' ');
      const actions = r.station ? r.actions.map(a => esc(a)).join('<br>') : '<span class="muted">—</span>';
      return `<tr class="${cls}">
        <td class="num"><strong>${r.mile}</strong>${hill}</td>
        <td class="wrap-ok">${esc(r.landmark)}<br><span class="muted">${esc(r.borough)} · ${fmtPace(r.pace)}</span></td>
        <td>${fmtClock(r.clockMin)}</td>
        <td class="num">${fmtDur(r.split)}</td>
        <td class="num">${fmtDur(r.elapsedSec)}</td>
        <td>${wx}</td>
        <td>${st}</td>
        <td class="wrap-ok">${actions}</td>
        <td class="num">${Math.round(r.carbsIn)} (${Math.round(r.carbsRate)})</td>
        <td class="num">${Math.round(r.fluidIn)}</td>
        <td class="num">${Math.round(r.sodiumIn)}</td>
        <td class="num">${Math.round(r.cafTaken)}</td>
      </tr>`;
    }).join('');
  }

  function renderCards(plan) {
    $('planCards').innerHTML = plan.rows.map(r => {
      const hill = r.gain >= 60 ? ' ▲' : r.loss >= 60 ? ' ▼' : '';
      const quiet = !r.station;
      const doText = r.station ? r.actions.join(' · ') : '';
      const tally = `${Math.round(r.carbsIn)} g carbs (${Math.round(r.carbsRate)}/hr) · ${Math.round(r.fluidIn)} ml · ${Math.round(r.sodiumIn)} mg Na${r.cafTaken ? ` · ${Math.round(r.cafTaken)} mg caf` : ''}`;
      const wx = r.wx && r.wx.temp != null ? ` · ${Math.round(r.wx.temp)}°F` : '';
      return `<div class="mcard ${quiet ? 'quiet' : ''} ${r.gelTaken ? 'gel' : ''}">
        <div class="top"><span>Mile ${r.mile}${hill}</span><span>${fmtClock(r.clockMin)} · ${fmtDur(r.elapsedSec)}</span></div>
        <div class="where">${esc(r.landmark)} · ${fmtPace(r.pace)}${wx}</div>
        ${quiet ? '' : `<div class="do">${esc(doText)}</div><div class="tally">${tally}</div>`}
      </div>`;
    }).join('');
  }

  // ---------- post-race review ----------
  let currentPlan = null, currentInp = null;
  let review = { log: null, splitSource: null, splits: null, feel: {}, preW: '', postW: '', splitText: '', act: null, nyrr: null };
  const FEEL_MILES = [5, 10, 15, 20, 25];
  const storeKey = () => 'fuel-review:' + $('course').value;
  function saveReview() {
    try { localStorage.setItem(storeKey(), JSON.stringify(review)); } catch {}
  }
  function loadReview() {
    try { const j = JSON.parse(localStorage.getItem(storeKey()) || 'null'); if (j && j.log) review = j; } catch {}
    const hasResults = !!courses[$('course').value].results;
    $('splitSource').value = review.splitSource || (hasResults ? 'bib' : 'finish');
    $('preW').value = review.preW || ''; $('postW').value = review.postW || ''; $('splitText').value = review.splitText || '';
    if (review.act) { $('actH').value = review.act[0]; $('actM').value = review.act[1]; $('actS').value = review.act[2]; }
    if (review.nyrr) { $('bib').value = review.nyrr.bib || ''; $('bibStatus').textContent = nyrrStatus(review.nyrr); }
    const rs = courses[$('course').value].results;
    $('splitSource').querySelector('option[value="bib"]').hidden = !rs;
    onSplitSource();
  }
  function onSplitSource() {
    const v = $('splitSource').value;
    $('splitFinish').hidden = v !== 'finish'; $('splitPaste').hidden = v !== 'paste'; $('splitFile').hidden = v !== 'file'; $('splitBib').hidden = v !== 'bib';
  }
  function currentSplits() {
    const v = $('splitSource').value;
    if (v === 'finish') {
      const sec = (+$('actH').value) * 3600 + (+$('actM').value) * 60 + (+$('actS').value);
      return sec > 3600 ? window.Review.fromFinishTime(sec, currentPlan) : null;
    }
    if (v === 'paste') return window.Review.parseSplitsText($('splitText').value, currentPlan.course);
    if (v === 'file') return review.splits;
    if (v === 'bib') return review.nyrr && review.nyrr.markers ? window.Review.splitsFromMarkers(review.nyrr.markers, currentPlan) : null;
    return null;
  }
  function renderFeel() {
    $('feelBody').innerHTML = FEEL_MILES.map(m => {
      const f = review.feel[m] || {};
      const opts = sel => [1, 2, 3, 4, 5].map(n => `<option value="${n}" ${sel == n ? 'selected' : ''}>${n}</option>`).join('');
      return `<tr><td>${m}</td>
        <td><select data-feel="energy" data-mile="${m}"><option value="">–</option>${opts(f.energy)}</select></td>
        <td><select data-feel="stomach" data-mile="${m}"><option value="">–</option>${opts(f.stomach)}</select></td>
        <td><input type="checkbox" data-feel="cramp" data-mile="${m}" ${f.cramp ? 'checked' : ''}></td></tr>`;
    }).join('');
  }
  function renderLog(splits) {
    const plan = currentPlan;
    const gelOpts = window.PRODUCTS.filter(p => p.type === 'gel' || p.type === 'chew' || p.type === 'food');
    const defaults = window.Review.logFromPlan(plan);
    $('logBody').innerHTML = plan.rows.map((r, i) => {
      const l = review.log[i], d = defaults[i];
      const changed = l.drink !== d.drink || l.water !== d.water || l.gel !== d.gel || !!l.salt !== !!d.salt || !!l.banana !== !!d.banana;
      const st = !!r.station;
      const sel = `<select data-log="gel" data-i="${i}"><option value="">none</option>${gelOpts.map(p => `<option value="${p.id}" ${l.gel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
      return `<tr class="${changed ? 'changed' : ''} ${st ? 'station' : ''}">
        <td class="num"><strong>${r.mile}</strong></td>
        <td class="wrap-ok muted">${st ? r.actions.map(esc).join('<br>') : '—'}</td>
        <td><input type="number" min="0" max="4" data-log="drink" data-i="${i}" value="${l.drink}" ${st && r.station.drink ? '' : 'disabled'}></td>
        <td><input type="number" min="0" max="4" data-log="water" data-i="${i}" value="${l.water}" ${st ? '' : 'disabled'}></td>
        <td>${sel}</td>
        <td><input type="checkbox" data-log="salt" data-i="${i}" ${l.salt ? 'checked' : ''} ${currentInp.saltId ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-log="banana" data-i="${i}" ${l.banana ? 'checked' : ''}></td>
        <td class="num">${splits ? fmtDur(splits[i]) : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');
  }
  function renderReview(opts = {}) {
    if (!currentPlan) return;
    if (!review.log || review.log.length !== currentPlan.rows.length) review.log = window.Review.logFromPlan(currentPlan);
    const splits = currentSplits();
    if (!opts.keepInputs) { renderLog(splits); renderFeel(); }
    const unitKg = $('weightUnit').value === 'kg';
    const toKg = v => v === '' || v == null ? null : (unitKg ? +v : +v * 0.4536);
    const feel = FEEL_MILES.map(m => ({ mile: m, ...(review.feel[m] || {}) })).filter(f => f.energy || f.stomach || f.cramp);
    const res = window.Review.analyze({ plan: currentPlan, inp: currentInp, splits, log: review.log, feel, preKg: toKg(review.preW), postKg: toKg(review.postW) });
    renderReviewResults(res, splits);
    $('reviewOutput').hidden = false;
  }
  function renderReviewResults(res, splits) {
    const t = res.totals, p = currentPlan.totals;
    const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
    $('reviewSummary').innerHTML = `
      <div class="stat"><div class="k">Actual finish</div><div class="v">${splits ? fmtDur(res.finishSec) : '—'}</div><div class="s">${splits ? `Plan was ${fmtDur(res.planFinish)}` : 'Not entered yet: add your bib, finish time or splits above'}</div></div>
      <div class="stat"><div class="k">Carbs</div><div class="v">${t.carbsRate} g/hr</div><div class="s">${t.carbs} g, ${pct(t.carbs, p.carbsIn)}% of plan</div></div>
      <div class="stat"><div class="k">Fluid</div><div class="v">${t.fluidRate} ml/hr</div><div class="s">${(t.fluid / 1000).toFixed(2)} L in race, plan ${p.fluidPerHr} ml/hr</div></div>
      <div class="stat"><div class="k">Sodium</div><div class="v">${t.sodiumRate} mg/hr</div><div class="s">${t.sodium} mg, plan ${p.sodiumPerHr} mg/hr</div></div>
      <div class="stat"><div class="k">Caffeine</div><div class="v">${t.caffeine} mg</div><div class="s">Plan ${p.caffeineMg} mg</div></div>
      ${res.sweat ? `<div class="stat"><div class="k">Measured sweat</div><div class="v">${res.sweat.rate.toFixed(2)} L/hr</div><div class="s">${res.sweat.pct.toFixed(1)}% body mass lost</div></div>` : ''}`;
    const icon = { good: '✓', warn: '!', bad: '✕', info: 'i' };
    $('findings').innerHTML = res.findings.map(f => `<div class="finding ${f.level}"><span class="ic">${icon[f.level] || 'i'}</span><span>${esc(f.text)}</span></div>`).join('');
    $('paceChart').innerHTML = paceChart(res);
    $('carbChart').innerHTML = carbChart(res);
    const sg = res.suggestions;
    const changes = [];
    if (sg.userSweat) changes.push(`Measured sweat rate ${sg.userSweat} L/hr replaces the estimate.`);
    if (sg.carbsPerHr !== currentInp.carbsPerHr) changes.push(`Carb target ${currentInp.carbsPerHr} → ${sg.carbsPerHr} g/hr.`);
    if (sg.drinkPref !== currentInp.drinkPref) changes.push('Water only at stations; carbs from gels.');
    if (sg.cramps) changes.push('Cramp history set to "Sometimes".');
    if (sg.goalSec) changes.push(`Goal time set to ${fmtDur(sg.goalSec)}.`);
    $('suggestions').innerHTML = `
      ${sg.notes.length ? '<ul>' + sg.notes.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>' : ''}
      ${changes.length ? `<p style="margin:0 0 8px;font-size:14px"><strong>Apply to the planner:</strong> ${changes.map(esc).join(' ')}</p><button id="applySugg" type="button">Apply and rebuild plan</button>` : '<p class="muted" style="margin:0">No input changes suggested. Add weights, splits or feel ratings for more.</p>'}`;
    const ap = $('applySugg');
    if (ap) ap.addEventListener('click', () => {
      if (sg.userSweat) $('sweat').value = sg.userSweat;
      $('carbs').value = String(sg.carbsPerHr);
      $('drinkPref').value = sg.drinkPref;
      if (sg.cramps) $('cramps').value = sg.cramps;
      if (sg.goalSec) { $('goalH').value = Math.floor(sg.goalSec / 3600); $('goalM').value = Math.floor((sg.goalSec % 3600) / 60); $('goalS').value = sg.goalSec % 60; }
      build(); setTab('day'); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---------- charts (inline SVG) ----------
  const W = 600, H = 220, PAD = { l: 44, r: 12, t: 10, b: 26 };
  function paceChart(res) {
    const rows = res.rows.filter(r => Number.isInteger(r.mile));
    const vals = rows.flatMap(r => [r.pace, r.planPace]);
    const lo = Math.floor(Math.min(...vals) / 30) * 30 - 15, hi = Math.ceil(Math.max(...vals) / 30) * 30 + 15;
    const x = m => PAD.l + (m - 1) / 25 * (W - PAD.l - PAD.r);
    const y = v => PAD.t + (v - lo) / (hi - lo) * (H - PAD.t - PAD.b);
    const path = key => rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.mile).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
    const ticks = []; for (let v = Math.ceil(lo / 30) * 30; v <= hi; v += 30) ticks.push(v);
    const label = v => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`;
    const dots = (key, cls) => rows.map(r => `<circle class="dot ${cls}" cx="${x(r.mile).toFixed(1)}" cy="${y(r[key]).toFixed(1)}" r="3" stroke="var(--${cls})"><title>Mile ${r.mile}: ${label(r[key])}/mi ${cls}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pace per mile, plan versus actual">
      <g class="grid">${ticks.map(v => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${PAD.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${label(v)}</text>`).join('')}</g>
      ${[1, 5, 10, 15, 20, 26].map(m => `<text x="${x(m).toFixed(1)}" y="${H - 8}" text-anchor="middle">${m}</text>`).join('')}
      <path class="plan" d="${path('planPace')}"/><path class="actual" d="${path('pace')}"/>
      ${dots('planPace', 'plan')}${dots('pace', 'actual')}
      <text x="${W - PAD.r}" y="${(y(rows[rows.length - 1].planPace) - 6).toFixed(1)}" text-anchor="end" fill="var(--plan)">plan</text>
      <text x="${W - PAD.r}" y="${(y(rows[rows.length - 1].pace) + 14).toFixed(1)}" text-anchor="end" fill="var(--actual)">actual</text>
    </svg><div class="legend"><span><i style="background:var(--plan)"></i>Plan</span><span><i style="background:var(--actual)"></i>Actual</span><span>min/mile, lower is faster</span></div>`;
  }
  function carbChart(res) {
    const hs = res.hours;
    const target = currentInp.carbsPerHr;
    const hi = Math.max(target, ...hs.flatMap(h => [h.carbsPlan, h.carbsActual])) * 1.15;
    const n = hs.length, slot = (W - PAD.l - PAD.r) / n, bw = Math.min(28, slot * 0.32);
    const y = v => PAD.t + (1 - v / hi) * (H - PAD.t - PAD.b);
    const base = y(0);
    const ticks = []; for (let v = 0; v <= hi; v += 30) ticks.push(v);
    const bar = (h, i, key, cls, off) => {
      const v = h[key], top = y(v), xx = PAD.l + i * slot + slot / 2 + off;
      return `<rect class="bar ${cls}" x="${xx.toFixed(1)}" y="${top.toFixed(1)}" width="${bw}" height="${Math.max(0, base - top).toFixed(1)}" rx="3"><title>Hour ${h.hour} ${cls}: ${Math.round(v)} g/hr</title></rect>
        <text x="${(xx + bw / 2).toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle">${Math.round(v)}</text>`;
    };
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Carbs per hour, plan versus actual">
      <g class="grid">${ticks.map(v => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${PAD.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}</g>
      <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <text x="${W - PAD.r}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end">target ${target} g/hr</text>
      ${hs.map((h, i) => bar(h, i, 'carbsPlan', 'plan', -bw - 1) + bar(h, i, 'carbsActual', 'actual', 1) + `<text x="${(PAD.l + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">hr ${h.hour}${h.frac < 0.99 ? '*' : ''}</text>`).join('')}
    </svg><div class="legend"><span><i style="background:var(--plan)"></i>Plan</span><span><i style="background:var(--actual)"></i>Actual</span><span>* partial hour, scaled</span></div>`;
  }

  const nyrrStatus = n => `Found ${n.name}, bib ${n.bib}: ${fmtDur(n.netTime)} net, place ${n.place}. ${Object.keys(n.markers).length} timing mats.`;
  async function fetchBib() {
    const rs = currentPlan.course.results; if (!rs) return;
    const bib = $('bib').value.trim(); if (!bib) { $('bibStatus').textContent = 'Enter a bib number.'; return; }
    $('bibStatus').textContent = 'Looking up…';
    try {
      const n = await window.Review.fetchNyrr(bib, rs.eventCode);
      review.nyrr = n; $('bibStatus').textContent = nyrrStatus(n);
    } catch (e) { review.nyrr = null; $('bibStatus').textContent = e.message || 'Lookup failed.'; }
    saveReview(); renderReview();
  }

  // ---------- review events ----------
  $('fetchBib').addEventListener('click', fetchBib);
  $('bib').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fetchBib(); } });
  $('splitSource').addEventListener('change', () => { review.splitSource = $('splitSource').value; onSplitSource(); saveReview(); renderReview(); });
  ['actH', 'actM', 'actS'].forEach(id => $(id).addEventListener('change', () => { review.act = [$('actH').value, $('actM').value, $('actS').value]; saveReview(); renderReview(); }));
  $('splitText').addEventListener('change', () => { review.splitText = $('splitText').value; saveReview(); renderReview(); });
  ['preW', 'postW'].forEach(id => $(id).addEventListener('change', () => { review[id] = $(id).value; saveReview(); renderReview(); }));
  $('trackFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    const segs = /tcx$/i.test(f.name) || /<TrainingCenterDatabase/.test(text) ? window.Review.parseTcx(text, currentPlan.course) : window.Review.parseGpx(text, currentPlan.course);
    if (!segs) { $('trackStatus').textContent = 'Could not read a full-marathon track from that file.'; review.splits = null; }
    else { review.splits = segs; $('trackStatus').textContent = `Read ${f.name}: finish ${fmtDur(segs.reduce((a, b) => a + b, 0))}.`; }
    saveReview(); renderReview();
  });
  $('feelBody').addEventListener('change', e => {
    const el = e.target, m = el.dataset.mile, k = el.dataset.feel; if (!k) return;
    review.feel[m] = review.feel[m] || {};
    review.feel[m][k] = el.type === 'checkbox' ? el.checked : (el.value ? +el.value : null);
    saveReview(); renderReview({ keepInputs: true });
  });
  $('logBody').addEventListener('change', e => {
    const el = e.target, i = +el.dataset.i, k = el.dataset.log; if (!k) return;
    review.log[i][k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, +el.value || 0) : el.value;
    const d = window.Review.logFromPlan(currentPlan)[i], l = review.log[i];
    el.closest('tr').classList.toggle('changed', l.drink !== d.drink || l.water !== d.water || l.gel !== d.gel || !!l.salt !== !!d.salt || !!l.banana !== !!d.banana);
    saveReview(); renderReview({ keepInputs: true });
  });
  $('resetLog').addEventListener('click', () => { review.log = window.Review.logFromPlan(currentPlan); saveReview(); renderReview(); });
  $('exportLog').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ course: $('course').value, exported: new Date().toISOString(), review }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `race-review-${$('course').value}.json`; a.click();
  });

  // ---------- share link ----------
  const FIELDS = ['course', 'wave', 'goalH', 'goalM', 'goalS', 'arrival', 'weight', 'weightUnit', 'height', 'heightUnit', 'age', 'sex', 'carbs', 'gel', 'cafGel', 'salt', 'useCourseGels', 'drinkPref', 'cupOz', 'sweat', 'sweatNa', 'caffeine', 'dailyCaf', 'cramps', 'crampKit', 'carbLoad', 'diet', 'cafTaper', 'lastRun', 'date', 'wxManual', 'wxTemp', 'wxHum', 'wxWind'];
  function stateToHash() {
    const o = formState();
    o._tab = document.body.classList.contains('tab-week') ? 'week' : 'day';
    return '#' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  }
  function hashToState() {
    if (!location.hash || location.hash.length < 2) return false;
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
      $('course').value = o.course || $('course').value; onCourseChange();
      for (const f of FIELDS) { if (!(f in o)) continue; const el = $(f); if (el.type === 'checkbox') el.checked = !!o[f]; else el.value = o[f]; }
      if (o._tab) setTab(o._tab);
      return true;
    } catch { return false; }
  }

  // ---------- named profiles (browser storage) ----------
  function formState() {
    const o = {};
    for (const f of FIELDS) { const el = $(f); o[f] = el.type === 'checkbox' ? el.checked : el.value; }
    return o;
  }
  function applyState(o) {
    if (o.course) { $('course').value = o.course; onCourseChange(); }
    for (const f of FIELDS) { if (!(f in o)) continue; const el = $(f); if (el.type === 'checkbox') el.checked = !!o[f]; else el.value = o[f]; }
  }
  function saveProfile() {
    const name = $('profile').value; if (!name) { $('profileStatus').textContent = 'Pick a name first.'; return; }
    try {
      localStorage.setItem('fuel-profile:' + name, JSON.stringify({ saved: Date.now(), state: formState() }));
      localStorage.setItem('fuel-profile:last', name);
      $('profileStatus').textContent = `Saved ${name} at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    } catch { $('profileStatus').textContent = 'Could not save (storage blocked).'; }
  }
  function loadProfile(name, quiet) {
    if (!name) { $('profileStatus').textContent = ''; return false; }
    let j = null;
    try { j = JSON.parse(localStorage.getItem('fuel-profile:' + name) || 'null'); } catch {}
    if (!j) { if (!quiet) $('profileStatus').textContent = `Nothing saved for ${name} yet. Fill the form and press Save.`; return false; }
    applyState(j.state);
    try { localStorage.setItem('fuel-profile:last', name); } catch {}
    $('profileStatus').textContent = `Loaded ${name} (saved ${new Date(j.saved).toLocaleDateString()}).`;
    return true;
  }
  $('saveProfile').addEventListener('click', saveProfile);
  $('profile').addEventListener('change', () => { if (loadProfile($('profile').value)) { if ($('wxManual').checked) build(); else fetchWeather(); } });

  // ---------- tabs ----------
  function setTab(name) {
    document.body.classList.remove('tab-day', 'tab-week');
    document.body.classList.add('tab-' + name);
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------- events ----------
  fillProducts(); fillCourses();
  const restored = hashToState();
  if (!restored) {
    let last = null; try { last = localStorage.getItem('fuel-profile:last'); } catch {}
    if (last) { $('profile').value = last; loadProfile(last, true); }
  }
  loadReview();
  $('course').addEventListener('change', () => { onCourseChange(); review = { log: null, splitSource: null, splits: null, feel: {}, preW: '', postW: '', splitText: '', act: null, nyrr: null }; loadReview(); build(); });
  $('wave').addEventListener('change', () => { onWaveChange(); build(); });
  $('fetchWx').addEventListener('click', fetchWeather);
  $('build').addEventListener('click', build);
  $('print').addEventListener('click', () => window.print());
  $('share').addEventListener('click', async () => {
    const url = location.origin + location.pathname + stateToHash();
    try { await navigator.clipboard.writeText(url); $('buildStatus').textContent = 'Share link copied.'; }
    catch { prompt('Copy this link', url); }
  });
  document.querySelectorAll('input, select').forEach(el => el.addEventListener('change', () => { if (!$('output').hidden) build(); }));
  fetchWeather();
})();
