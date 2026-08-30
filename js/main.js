/* ============================================================================
 * main.js — bootstrap, live-forecast helper, view routing & event wiring
 * ----------------------------------------------------------------------------
 * Loaded LAST. Fits the model once (heavy work off the paint thread via a
 * short defer so the spinner shows), then hands the result to each view.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  const F = RC.features;

  /* ---- formatting helpers (shared) ------------------------------------- */
  const fmtClock = min => {
    if (min == null) return '—';
    let m = Math.round(((min % 1440) + 1440) % 1440);
    const days = Math.floor(Math.round(min) / 1440);
    const h = Math.floor(m / 60), mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (days > 0 ? ' +' + days + 'd' : '');
  };
  const fmtDelay = d => (d > 0 ? '+' : '') + Math.round(d) + ' min';
  const severity = d => d < 10 ? 1 : d <= 30 ? 2 : 3;
  const round1 = x => Math.round(x * 10) / 10;
  RC.fmt = { fmtClock, fmtDelay, severity, round1 };

  /* ---- normalise the enriched live data --------------------------------- *
   * ml/train.py attaches a held-out ground-truth run per live train (actual
   * delay per station of a real test-split day) so the step-forward demo can
   * reveal truth as the train advances. We just read it here.                 */
  function attachGroundTruth(P) {
    return RC.data.live
      .filter(L => P.trainsIdx[L.train_no])     // ignore live rows for unknown trains
      .map(L => {
        const refSeq = L.refSeq != null ? L.refSeq : L.last_reported_station_seq;
        let actual = L.actualDelay;
        // admin-created live rows may lack a ground-truth journey — fill so the
        // step-forward timeline can't crash on a missing seq.
        if (!actual || typeof actual !== 'object') {
          actual = {};
          const n = P.trainsIdx[L.train_no].stations.length;
          for (let s = 1; s <= n; s++) actual[s] = L.current_delay_min;
        }
        return { train_no: L.train_no, refSeq, groundTruthDate: L.groundTruthDate,
                 actualDelay: actual, current_delay_min: L.current_delay_min };
      });
  }

  /* ---- forecast the full journey for a train given the current ref seq -- *
   * Future stations use HISTORICAL EXPECTED context (mean congestion / speed /
   * preceding-train delay per section from training runs) — the information an
   * operator actually has at forecast time.                                    */
  function forecast(P, trainNo, refSeq, currentDelay, today, overrides) {
    const train = P.trainsIdx[trainNo];
    const st = train.stations;
    const nSt = st.length;
    const depHour = Math.floor((st[0]._depMin % 1440) / 60);
    const isNight = (depHour >= 22 || depHour < 5) ? 1 : 0;
    const isMonsoon = (today.month >= 6 && today.month <= 9) ? 1 : 0;
    const ov = overrides || null;   // admin what-if conditions ahead (optional)

    const out = [];
    for (let seq = 1; seq <= nSt; seq++) {
      const s = st[seq - 1];
      const base = { seq, code: s.code, name: s.name, km: s.km, halt: s.halt_min,
        schedArrMin: s._arrMin, schedDepMin: s._depMin };
      if (seq < refSeq) { base.role = 'passed'; }
      else if (seq === refSeq) { base.role = 'current'; base.actualDelay = currentDelay; base.sev = severity(currentDelay); }
      else {
        base.role = 'future';
        // expected context ahead (historical), overridable by the admin console
        let cong = 0, cnt = 0, sr = 0;
        for (let q = refSeq + 1; q <= seq; q++) { cong += P.hist.congMean(trainNo, q); sr += P.hist.srMean(trainNo, q); cnt++; }
        const ctx = {
          current_delay_min: currentDelay,
          section_congestion_idx: (ov && ov.congestion != null) ? ov.congestion : (cnt ? cong / cnt : 0.4),
          preceding_train_delay_min: (ov && ov.preceding != null) ? ov.preceding : P.hist.precMean(trainNo, seq),
          speed_restriction_km: (ov && ov.speedKm != null) ? ov.speedKm : sr,
          day_of_week: today.dow,
          is_monsoon: (ov && ov.monsoon != null) ? ov.monsoon : isMonsoon,
          is_night_run: (ov && ov.night != null) ? ov.night : isNight
        };
        const raw = F.rawFeatures(train, st, refSeq, seq, P.hist, ctx);
        const x = P.buildFull(raw);
        // thin inference: dot-product + lead-time-conditional interval scale
        // (stations ahead = seq − refSeq). Endpoints already back-transformed.
        const pi = RC.modelapi.predictionInterval(x, P.sigmaByLead(seq - refSeq));
        let yh = pi.yhat, lo = pi.lo, hi = pi.hi;
        if (lo > hi) { const t = lo; lo = hi; hi = t; }
        base.predDelay = yh; base.lo = lo; base.hi = hi; base.sev = severity(yh);
        // static baseline
        const pad = P.paddingAhead(st, refSeq, seq);
        base.staticDelay = Math.max(0, currentDelay - pad);
        base.predArrMin = s._arrMin + yh; base.loArrMin = s._arrMin + lo; base.hiArrMin = s._arrMin + hi;
        base.staticArrMin = s._arrMin + base.staticDelay;
      }
      out.push(base);
    }
    return out;
  }

  /* ---- routing --------------------------------------------------------- */
  function route(P) {
    const views = { admin: RC.ui.admin, timeline: RC.ui.timeline, compare: RC.ui.compare, coefficients: RC.ui.coefficients, diagnostics: RC.ui.diagnostics };
    const tabs = Array.from(document.querySelectorAll('.nav button'));
    const rendered = {};
    function show(name) {
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === name)));
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
      if (!rendered[name] && views[name]) { views[name].render(P, document.getElementById('view-' + name)); rendered[name] = true; }
      else if (views[name] && views[name].onShow) views[name].onShow();
    }
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
    show('admin');
    // re-render charts on resize (debounced) so canvases stay crisp
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => {
      const active = document.querySelector('.view.active'); if (!active) return;
      const name = active.id.replace('view-', '');
      if (views[name] && views[name].redraw) views[name].redraw();
    }, 150); });
  }

  /* ---- boot ------------------------------------------------------------ */
  function boot() {
    setTimeout(async () => {
      // pull catalog / model / live from Supabase if configured; otherwise this
      // is a no-op and the embedded data (already loaded) is used.
      try { await RC.db.loadAll(); } catch (e) { /* db.js handles its own fallback */ }

      const today = (() => {
        const L = (RC.data.live && RC.data.live[0]) || { run_date: '2026-08-27' };
        const d = new Date(L.run_date + 'T00:00:00Z');
        return { date: L.run_date, dow: d.getUTCDay(), month: d.getUTCMonth() + 1 };
      })();

      let P;
      try { P = RC.assemble.build(); }
      catch (e) { document.getElementById('boot').innerHTML = '<p class="neg">Could not load model: ' + e.message + '</p>'; console.error(e); return; }
      P.live = attachGroundTruth(P);
      P.today = today;
      RC.app = { forecast, today };
      document.getElementById('boot').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      // header status shows where the data came from
      const src = (RC.db && RC.db.source) || 'embedded';
      const label = src === 'database' ? 'Supabase · live board' : 'offline data';
      document.getElementById('fit-status').textContent =
        `${label} · scikit-learn model · n=${P.metrics.nTrain.toLocaleString()}/${P.metrics.nTest.toLocaleString()}`;
      route(P);
    }, 40);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(this);
