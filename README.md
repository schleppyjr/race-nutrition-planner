# Race Fuel Planner

Static web app that builds a mile-by-mile fueling plan (gels, sports drink, water, salt, caffeine) for a marathon, using the course's real aid-station layout, the runner's goal time and the race-day weather.

## Live site

https://schleppyjr.github.io/race-nutrition-planner/ (GitHub Pages, deployed from `main`)

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8080
```

Weather is fetched client-side from Open-Meteo (no key needed). Everything else runs in the browser; nothing is stored on a server.

## Layout

- `index.html` – form and output page
- `css/style.css` – styles, dark mode, print layout
- `js/planner.js` – the fueling model (pure functions, no DOM)
- `js/app.js` – form wiring, weather fetch, rendering, tabs, share links
- `js/week.js` – race-week model: carb load, sodium preload, caffeine taper, logistics, sample menus
- `js/review.js` – post-race review: GPX/TCX/split parsing, actual-intake tallies, findings, next-race suggestions
- `data/products.js` – gel / chew / salt / drink library (per-serving carbs, sodium, caffeine)
- `data/course-nyc-2026.js` – NYC 2026 course: waves, per-mile elevation, aid stations, course gels

## Adding a course

Copy `data/course-nyc-2026.js`, change the id, waves, `miles` (gain/loss in feet per mile) and `stations`, and add a `<script>` tag for it in `index.html`. The planner picks it up from `window.COURSES`.

## Model summary

Post-race tab: log what was actually taken per mile (pre-filled from the plan), add splits (finish time, pasted splits, or a GPX/TCX file parsed in the browser), pre/post weights and feel ratings. It compares plan and actual by hour, detects fades and links them to fueling or pacing, computes measured sweat rate, and can apply suggested inputs (sweat rate, carb target, drink choice, cramp history, goal time) back to the planner. Saved in localStorage only; exportable as JSON.

Race week tab: 5 to 6 g/kg carbs early in the week, a 7 g/kg ramp day, then a two-day 10 g/kg load (or three days at 8, or a light 6.5), protein near 1.6 g/kg, fiber and fat cut in the last two days, 1 to 3 g extra sodium on race eve, optional caffeine taper from four days out, and course logistics (expo, start transport) keyed by days out in the course file.


- Splits: goal time spread over miles with a hill cost (about +3.5% time per 1% climb, −1.8% per 1% descent) plus a small start-congestion factor.
- Sweat rate: estimated from weight, pace and apparent temperature (or a measured value). Fluid target is about 75% of sweat, floored at 350 ml/hr and capped at 900 ml/hr.
- Carbs: user target (45 to 120 g/hr). Sports drink at stations counts first; a gel is scheduled when the running deficit justifies it and at least 18 min have passed since the last one.
- Sodium: 60% of estimated sweat sodium loss, 200 to 1000 mg/hr; salt capsules scheduled when the deficit reaches one capsule.
- Caffeine: 0 to 5 mg/kg. About 40% an hour before the start, the rest as caffeinated gels from 55% distance, spaced at least 4 miles apart.
- Energy burn: about 1 kcal per kg per km; resting energy via Mifflin-St Jeor (display only).

Product values are approximate and should be checked against labels. Not medical advice.
