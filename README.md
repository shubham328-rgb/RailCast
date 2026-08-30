# RailCast — dynamic ETA forecasting for Indian Railways

**Smart India Hackathon 2026 · SIH26028 · Ministry of Railways**

RailCast predicts the **delay in minutes at every remaining station** of a running
coaching train, with **95% prediction intervals**, and measurably beats the
static-schedule ETA that Indian Railways uses today.

The model is a single **multiple linear regression fitted by ordinary least squares**.
The sophistication lives in the feature engineering and the statistical rigour, not in
a fancier learner.

## Architecture at a glance: Python fits, the browser infers

- **`ml/` (Python — pandas, numpy, scikit-learn, matplotlib, seaborn)** does *all* the
  fitting and statistics: it engineers the features, splits by date, fits the three
  tiers with `sklearn.linear_model.LinearRegression`, and computes standard errors,
  t-stats, p-values, R², adjusted R², F, VIF, residual std error, and interval
  coverage with numpy. It exports two JSON files and a set of 150-DPI plots.
- **The browser** does **no fitting and computes no statistics**. It loads the exported
  `model.json` and `metrics.json` and only: standardises live features, takes a dot
  product with the coefficients, applies the inverse target transform, and forms the
  prediction interval from the exported `residual_std_error` and `xtx_inv_diag`. Every
  number on screen originates in `metrics.json`.

The app still runs by **opening `index.html` with no server**.

### The five views

- **Admin Console** *(default)* — an operator picks any of the **39 trains**, the station it
  last reported from, and **types the current delay in minutes**. The model instantly projects
  the delay, ETA and 95% prediction interval at every remaining stop, next to the static
  baseline. An optional "conditions ahead" panel runs what-ifs (section congestion, preceding-
  train delay, speed restriction, monsoon/night). This is pure inference — the same
  `RC.app.forecast` the timeline uses.
- **Live Timeline** — a running train stepped stop-by-stop against a held-out ground-truth day.
- **Baseline Comparison** — MAE vs lead time for the three tiers, plus the headline strip.
- **Coefficients** — the full regression table (β, SE, t, p, VIF) with plain-English lines.
- **Diagnostics** — residuals-vs-fitted, Q-Q, histogram, predicted-vs-actual, coverage, breakdowns.

---

## 1. How to run

### Run the app (what a judge does)

**Just open `index.html`.** No install, no server, no internet. The pre-built exports
(`data/model.json`, `data/metrics.json`) are already in the repo.

### Rebuild the model (optional, reproducible)

```bash
node data/generate.js       # 1. synthetic data  -> data/{trains,runs,live}.json
pip install -r ml/requirements.txt
# 2. fit + export  -> data/model.json, data/metrics.json, ml/plots/
#    open ml/train.ipynb in Jupyter and Run All, or headless:
jupyter nbconvert --to notebook --execute --inplace ml/train.ipynb
```

Then reopen `index.html`. Run order matters: **generate, then train** (the notebook reads the
generated data and enriches `data/live.js` with a held-out ground-truth run for the
step-forward demo).

### The `file://` design note (why classic scripts, not ES modules)

The original brief asked for **both** ES modules **and** "runs by opening `index.html`
via `file://` with zero console errors." These conflict in Chromium browsers: Chrome
and Edge block ES-module `import` **and** `fetch()` from a `file://` origin as a CORS
policy (Firefox allows it). SIH judging almost certainly happens on Chrome/Edge, so we
honoured the higher-priority constraint:

- the app loads via **classic `<script>` tags on a single `RC` namespace** — still pure
  vanilla JS, no bundler, no framework, no CDN, no build step;
- data **and the Python model exports** are embedded as JS wrappers (`data/*.js` assign
  to `RC.data.* / RC.model / RC.metrics`) instead of being `fetch`ed, so there is no
  network request to block. Canonical `data/*.json` files are emitted alongside for
  inspection and are what `ml/train.ipynb` reads.

---

## 2. Results (measured, held-out, honest)

Evaluated on a **date-based** train/test split — the last 20 days held out, never seen
during fitting or during computation of the historical features. Numbers are produced
by `ml/train.ipynb` and printed inline as it runs.

| Tier | Model | Test MAE (min) | Test RMSE (min) | vs static |
|-----:|-------|---------------:|----------------:|----------:|
| 0 | Static schedule (today's method) | **10.21** | 13.10 | — |
| 1 | Simple regression (current delay only) | **7.02** | 9.36 | −31.3% |
| 2 | **Multiple regression (deployed)** | **4.28** | 5.44 | **−58.1%** |

**Tier 2 is 58.1% better than the railway's current logic and 39.0% better than simple
regression, in MAE.**

Model quality (Tier 2, deployed raw-target specification):

- **R² = 0.751, adjusted R² = 0.750**
- **F = 2724** on (25, ~22.6k) df → overall significance p ≈ 0
- **Residual standard error = 5.12 min**
- **Observed 95% prediction-interval coverage = 94.9%** (measured on the test set — see §6)
- n = 22,648 training examples / 5,960 test examples, across **39 trains**

> We do **not** claim quality from R² alone. The claim that matters is **MAE in minutes
> against the railway's own baseline**, split by date so there is no leakage.

**Why MAE and the date split.** MAE is what a station master feels ("the ETA was off by
4 minutes"); RMSE is reported alongside and weights the occasional large miss (RMSE > MAE
by ~1.2 min → a few big misses / the right tail). We split by date, never randomly:
shuffling station arrivals would leak a train's later state into its own earlier
prediction and leak future days into the past, inflating every metric.

---

## 3. Why linear regression (and not deep learning / XGBoost)

**Interpretability is an operational requirement here.** When an ETA moves by 20 minutes,
Indian Railways must explain *why* to a station master and passengers. Every coefficient
has a **defensible physical meaning** (§4) and a **significance test** attached (t, p, and
a VIF).

OLS is the **floor, not the ceiling** — the modelling work is the feature engineering. A
tree ensemble would be a drop-in upgrade **on the same feature matrix** if interpretability
were traded away.

**"Isn't it non-linear?"** OLS is linear *in the parameters*, not the variables. The
specification includes `delay_squared` (saturation), `sqrt_km_remaining` (sub-linear
accumulation), and two interaction terms. We also fitted a **log-transformed target** and
compared it honestly (§5).

---

## 4. Features and their operational rationale

Target `y` = actual delay (min) at the target station. A training example is a
`(run, r, t)` triple: given the state at the last-reported station **r**, predict the
delay at a downstream station **t**. The **same 18 predictors** are built identically in
the notebook and `js/features.js` (they expand to 25 columns because `type` is 3
dummies and `day_of_week` is 6).

Continuous predictors are **standardised** (mean/SD learned on the training split, in
Python); dummies are left unstandardised. The scaler ships in `model.json`; the browser
only *applies* it.

**Core — state & geometry:** `current_delay_min` (delay persists — strongest signal),
`stations_ahead`, `km_remaining`, `halt_minutes_ahead` (halts absorb delay),
`padding_ratio` (recovery slack in the timetable).
**Historical memory (train split only):** `hist_delay_mean` (chronic problem stops for
this train), `hist_section_delay_mean` (section difficulty).
**Live context:** `section_congestion_idx`, `preceding_train_delay_min` (block ahead),
`speed_restriction_km`, `is_monsoon`, `is_night_run`.
**Categorical (drop-one):** `type_{rajdhani,superfast,express}` (ref = Passenger),
`dow_{mon…sat}` (ref = Sunday).
**Interactions/transforms:** `delay_x_stations_ahead`, `delay_x_padding_ratio`,
`sqrt_km_remaining`, `delay_squared`.

For a **live** forecast, the "ahead" context uses **historical expected values per
section** (exported in `model.json.lookups`) while `current_delay_min` comes from the
live report.

---

## 5. Target transformation: raw vs log(y+1)

The notebook fits **twice** — raw `y` and `log(y+1)` — and picks by held-out MAE rather
than assuming. Early arrivals (negative delay) are floored at 0 before the log; predictions
back-transform with `expm1`. **Measured:** raw won (**4.28** vs **6.19 min** MAE); `expm1`
amplifies error on the long right tail (much worse log RMSE). **Deployed: raw target.** The
app labels the deployed spec; `js/model.js` applies the matching inverse transform.

---

## 6. Diagnostics and honest limitations

The **Diagnostics** view (and `ml/plots/`) show, on the held-out set: residuals-vs-fitted
(a **funnel** → heteroscedasticity), a normal **Q-Q** (heavier right tail), the residual
histogram, predicted-vs-actual on the 45° line, **94.9%** interval coverage, and MAE by
train type and lead time.

**Prediction intervals.** Point prediction and every coefficient statistic are **pure OLS**.
The interval starts from OLS theory, `ŷ ± z·σ·√(1 + xᵀ(XᵀX)⁻¹x)`, exported so the browser
needs only `residual_std_error`, `xtx_inv_diag`, and `z95` — no matrix algebra. Because the
residual plot shows σ is **not** constant, the notebook also exports a **lead-time-
conditional residual scale** (`residual_std_by_lead`); using it honestly reflects the
diagnosed heteroscedasticity, makes near-term intervals tighter (σ ≈ 4.5 min at 1 stop → 7.7
at 8 stops) so the **interval visibly narrows as the train nears its destination**, and lifts
observed coverage to 94.9%.

**Known weaknesses (stated, not hidden):**

1. **Heteroscedasticity** — variance grows with lead time. The conditional interval scale
   partly accounts for it; weighted least squares or quantile regression would be more
   principled. OLS point estimates stay unbiased; only the classical SEs are affected.
2. **Non-independent observations** — multiple `(r,t)` examples share a physical run, so the
   effective sample is smaller than n and the **classical SEs are somewhat optimistic**.
   Cluster-robust SEs by run would be the honest fix; we report classical and flag this.
3. **Multicollinearity by construction** — VIF > 5 is flagged where a variable coexists with
   its own transform (`km_remaining`/`√km_remaining`, `current_delay`/`delay²`). It inflates
   those SEs but does not bias coefficients or hurt prediction, and the terms improve held-out
   MAE, so they are kept.
4. **Synthetic data** — an explicit generative process (§8); realistic in character but real
   IR feeds would shift the coefficients.

---

## 7. The three baselines (the pitch)

- **Tier 0 — Static schedule.** Predicted delay = current delay − available recovery padding,
  floored at zero. **What Indian Railways effectively does today.**
- **Tier 1 — Simple linear regression.** One predictor: `current_delay_min`.
- **Tier 2 — Multiple linear regression.** The full specification. Our model.

The **Baseline Comparison** view charts MAE vs stations-ahead for all three with a summary
strip of overall MAE and % improvement.

---

## 8. Project layout

```
railcast/
├── index.html               # loads data + model exports + JS (classic scripts)
├── css/  reset / theme / app
├── js/
│   ├── features.js          # the 18-predictor spec + apply-scaler (no fitting)
│   ├── model.js             # ~40-line inference: dot product, inverse transform, PI
│   ├── data.js              # index schedules, wrap lookups, map exports to view shape
│   ├── charts.js            # Canvas 2D primitives (line, scatter, histogram, Q-Q)
│   ├── main.js              # bootstrap, live forecast, view routing
│   └── ui/                  # admin, timeline, compare, coefficients, diagnostics
├── ml/                      # PYTHON — all fitting & statistics
│   ├── train.ipynb          # self-contained: features + fit (sklearn) + numpy stats + export + plots
│   ├── requirements.txt
│   └── plots/               # 7 presentation plots at 150 DPI
└── data/
    ├── generate.js          # DEV-ONLY Node synthetic-data generator
    ├── trains.json / .js    # 39 trains, full schedules
    ├── runs.json            # 32,352 station arrivals over 96 days (Python input)
    ├── live.json / .js      # live trains, enriched by the notebook with ground truth
    ├── model.json / .js     # EXPORT: coefficients, scaler, PI params, lookups
    └── metrics.json / .js   # EXPORT: all MAE/RMSE, breakdowns, coef table, coverage
```

> `js/ols.js` and `js/matrix.js` were **removed** in the refactor — the browser no longer
> does any matrix algebra or fitting. `data/runs.js` is no longer shipped to the browser
> (only Python reads `runs.json`).

### `ml/train.ipynb` — fitting and inference

Coefficients come from `sklearn.linear_model.LinearRegression` (it solves the same
least-squares problem as the normal equations). Everything else is numpy, from X and y,
nothing hardcoded:

- `se(βⱼ) = √(σ²·(XᵀX)⁻¹ⱼⱼ)`, `σ² = RSS/(n−k)`, residual std error `= √σ²`
- t-stats and two-tailed p-values (**normal approximation** to Student's t; with df in the
  thousands, t ≈ z past the 4th decimal — noted in code)
- R², adjusted R², F-statistic
- **VIF** per predictor (regress each on all the others); >5 flagged
- `xtx_inv_diag` — the diagonal of `(XᵀX)⁻¹`, exported for the browser's prediction interval

### Synthetic data generator (`data/generate.js`)

Produces the right statistical character on purpose: right-skewed delays (exponential
noise, floored near zero), propagation (a persistence term), recovery (padded sections shed
delay), section-level congestion, plus preceding-train, speed-restriction, weather, and
monsoon effects. 39 trains across 11 real corridors, 96 days, 32,352 records. The "true"
generative coefficients are never given to the model — OLS recovers structure from data.

---

## 9. Accessibility & design

Dark, high-contrast operations aesthetic; all tokens in `theme.css`. One accent for the
**model**, a muted tone for the **baseline**, a three-step **severity** ramp. System fonts
only (no external requests). Responsive to tablet via Grid/Flexbox. Keyboard-navigable with
visible focus; every Canvas chart carries `role="img"` and an `aria-label` text alternative.
No animation over 200 ms; `prefers-reduced-motion` respected.

---

## 10. Judge Q&A cheat-sheet

- **Why not deep learning / XGBoost?** Interpretability is operational; every coefficient is
  explainable and significance-tested. OLS is the floor; a tree ensemble is a drop-in upgrade
  on the same feature matrix. (§3, Coefficients view, `ml/plots/coefficient_significance.png`.)
- **Isn't it non-linear?** Linear in the *parameters*; includes `delay²`, `√km_remaining`, two
  interactions; log target tested. (§3, §5.)
- **How do you know it's better?** Baseline Comparison: MAE in minutes vs the railway's own
  logic, split by date, by lead time. −56.8% overall. (§2, §7.)
- **Weaknesses?** Heteroscedasticity (the funnel) and non-independent within-run observations
  making classical SEs optimistic — both in §6 and on screen.
- **Where does the model run?** Fitted offline in Python (sklearn + numpy); the browser only
  does inference (dot product + interval) from the exported JSON. (§Architecture, `ml/train.ipynb`,
  `js/model.js`.)
```
