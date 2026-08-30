/* ============================================================================
 * features.js — feature engineering for the delay model
 * ----------------------------------------------------------------------------
 * A single training example is a (run, r, t) triple: given the train's state at
 * the last-reported station r, predict the delay at a downstream target t.
 * Every predictor below carries a stated OPERATIONAL rationale — this is where
 * the modelling work lives, per the brief.
 *
 * Continuous predictors are STANDARDISED (subtract mean, divide by std) using
 * statistics learned on the TRAINING split only; the scaler is stored so live
 * predictions and coefficient interpretation can be un-standardised. Dummy /
 * binary columns are left unstandardised (a 0/1 contrast is already meaningful).
 * ========================================================================== */
(function (global) {
  'use strict';

  const AVG_SPEED = 60; // km/h reference for the padding_ratio denominator

  // Column order is fixed and shared by every consumer (fit, predict, table).
  // 'c' = continuous (standardised), 'd' = dummy/binary (left as-is).
  const SPEC = [
    // --- Core: state + geometry of the remaining run --------------------
    ['current_delay_min', 'c', 'Delay already accrued at the last reported station — the strongest single signal; delay tends to persist.'],
    ['stations_ahead', 'c', 'Stops remaining to target — more stops means more chances to gain or shed delay.'],
    ['km_remaining', 'c', 'Track distance left to run to the target station.'],
    ['halt_minutes_ahead', 'c', 'Total scheduled halt time between here and target — halts are elastic and absorb delay.'],
    ['padding_ratio', 'c', 'Scheduled run time ÷ pure run time (km/avg speed); >1 means recovery slack built into the timetable.'],
    // --- Historical memory ----------------------------------------------
    ['hist_delay_mean', 'c', 'Mean historical delay for THIS train at the target station — captures chronic problem stops.'],
    ['hist_section_delay_mean', 'c', 'Mean historical delay added on the sections of the remaining route — section difficulty.'],
    // --- Live network context -------------------------------------------
    ['section_congestion_idx', 'c', 'Mean traffic congestion on the sections ahead — competes for the same track paths.'],
    ['preceding_train_delay_min', 'c', 'Delay of the train immediately ahead — you cannot arrive before the block clears.'],
    ['speed_restriction_km', 'c', 'Total km under temporary speed restriction ahead — engineering/weather caution orders.'],
    // --- Interaction & transformed terms (raw values built here, then std)-
    ['delay_x_stations_ahead', 'c', 'current_delay × stations_ahead — a given delay matters more when far from target.'],
    ['delay_x_padding_ratio', 'c', 'current_delay × padding_ratio — recovery slack moderates how much delay persists.'],
    ['sqrt_km_remaining', 'c', '√km_remaining — delay accumulates sub-linearly with distance, not proportionally.'],
    ['delay_squared', 'c', 'current_delay² — saturation: very large delays stop growing (crew/priority interventions).'],
    // --- Binary flags (unstandardised) ----------------------------------
    ['is_monsoon', 'd', 'June–September: monsoon degrades running everywhere.'],
    ['is_night_run', 'd', 'Departure 22:00–05:00: fewer paths but also freight windows; distinct delay regime.'],
    // --- Categorical dummies, drop-one (avoid the dummy-variable trap) ---
    ['type_rajdhani', 'd', 'Train type = Rajdhani (Passenger is the reference level).'],
    ['type_superfast', 'd', 'Train type = Superfast (reference: Passenger).'],
    ['type_express', 'd', 'Train type = Express (reference: Passenger).'],
    ['dow_mon', 'd', 'Monday (reference: Sunday).'],
    ['dow_tue', 'd', 'Tuesday (reference: Sunday).'],
    ['dow_wed', 'd', 'Wednesday (reference: Sunday).'],
    ['dow_thu', 'd', 'Thursday (reference: Sunday).'],
    ['dow_fri', 'd', 'Friday (reference: Sunday).'],
    ['dow_sat', 'd', 'Saturday (reference: Sunday).']
  ];

  const NAMES = SPEC.map(s => s[0]);
  const KIND = {}; SPEC.forEach(s => KIND[s[0]] = s[1]);
  const RATIONALE = {}; SPEC.forEach(s => RATIONALE[s[0]] = s[2]);

  /* Build the RAW (pre-standardisation) feature object for one (r,t) example.
   * ctx supplies the aggregated "ahead" conditions (from recorded run data for
   * training, or from historical expectations for a live forecast). */
  function rawFeatures(train, stations, r, t, hist, ctx) {
    const sr = stations[r - 1], st = stations[t - 1];
    const kmRemaining = st.km - sr.km;
    const stationsAhead = t - r;

    // sum scheduled halts strictly between r and t
    let haltAhead = 0;
    for (let q = r; q < t - 1; q++) haltAhead += stations[q].halt_min || 0; // seq r+1..t-1

    // padding ratio = scheduled run minutes / pure run minutes
    const schedRunMin = (st._arrMin - sr._depMin);
    const pureRunMin = (kmRemaining / AVG_SPEED) * 60;
    const paddingRatio = pureRunMin > 0 ? schedRunMin / pureRunMin : 1;

    const curDelay = ctx.current_delay_min;

    const type = train.type;
    const dow = ctx.day_of_week;

    return {
      current_delay_min: curDelay,
      stations_ahead: stationsAhead,
      km_remaining: kmRemaining,
      halt_minutes_ahead: haltAhead,
      padding_ratio: paddingRatio,
      hist_delay_mean: hist.stationMean(train.train_no, t),
      hist_section_delay_mean: hist.segmentMean(train.train_no, r, t),
      section_congestion_idx: ctx.section_congestion_idx,
      preceding_train_delay_min: ctx.preceding_train_delay_min,
      speed_restriction_km: ctx.speed_restriction_km,
      delay_x_stations_ahead: curDelay * stationsAhead,
      delay_x_padding_ratio: curDelay * paddingRatio,
      sqrt_km_remaining: Math.sqrt(Math.max(0, kmRemaining)),
      delay_squared: curDelay * curDelay,
      is_monsoon: ctx.is_monsoon,
      is_night_run: ctx.is_night_run,
      type_rajdhani: type === 'Rajdhani' ? 1 : 0,
      type_superfast: type === 'Superfast' ? 1 : 0,
      type_express: type === 'Express' ? 1 : 0,
      dow_mon: dow === 1 ? 1 : 0,
      dow_tue: dow === 2 ? 1 : 0,
      dow_wed: dow === 3 ? 1 : 0,
      dow_thu: dow === 4 ? 1 : 0,
      dow_fri: dow === 5 ? 1 : 0,
      dow_sat: dow === 6 ? 1 : 0
    };
  }

  /* Turn a raw feature object into a design-matrix ROW (intercept first).
   * The scaler {mean,std} is the one FITTED IN PYTHON (from model.json); the
   * browser only applies it — it computes no scaling statistics of its own. */
  function designRow(raw, scaler) {
    const row = new Array(NAMES.length + 1);
    row[0] = 1; // intercept
    for (let j = 0; j < NAMES.length; j++) {
      const name = NAMES[j];
      if (KIND[name] === 'c') row[j + 1] = (raw[name] - scaler.mean[name]) / scaler.std[name];
      else row[j + 1] = raw[name];
    }
    return row;
  }

  // labels including the intercept, in column order
  const COLUMN_NAMES = ['intercept'].concat(NAMES);

  global.RC = global.RC || {};
  global.RC.features = {
    SPEC, NAMES, KIND, RATIONALE, COLUMN_NAMES, AVG_SPEED,
    rawFeatures, designRow
  };
})(this);
