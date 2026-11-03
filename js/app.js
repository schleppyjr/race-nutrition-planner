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

  // ---------- share link ----------
  const FIELDS = ['course', 'wave', 'goalH', 'goalM', 'goalS', 'arrival', 'weight', 'weightUnit', 'height', 'heightUnit', 'age', 'sex', 'carbs', 'gel', 'cafGel', 'salt', 'useCourseGels', 'drinkPref', 'cupOz', 'sweat', 'sweatNa', 'caffeine', 'dailyCaf', 'cramps', 'crampKit', 'carbLoad', 'diet', 'cafTaper', 'lastRun', 'date', 'wxManual', 'wxTemp', 'wxHum', 'wxWind'];
  function stateToHash() {
    const o = {};
    for (const f of FIELDS) { const el = $(f); o[f] = el.type === 'checkbox' ? el.checked : el.value; }
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
  $('course').addEventListener('change', () => { onCourseChange(); build(); });
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
