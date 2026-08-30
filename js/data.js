/* ============================================================================
 * data.js — assemble the app state from the Python exports (no fitting here)
 * ----------------------------------------------------------------------------
 * The model is fitted offline by ml/train.py. This module only:
 *   - parses train schedules into absolute minutes (geometry for the timeline),
 *   - wraps the exported historical lookups so features.js can build live rows,
 *   - maps model.json / metrics.json into the object shape the four views read.
 * No coefficient, standard error, VIF, or any statistic is computed in the
 * browser — every number on screen originates in metrics.json.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  const F = RC.features;
  const AVG_SPEED = F.AVG_SPEED;

  function toMin(hm) { if (!hm) return null; const [h, m] = hm.split(':').map(Number); return h * 60 + m; }

  // parse schedule times to absolute minutes with overnight wrap (geometry only)
  function indexTrains(trainsRaw) {
    const trains = {};
    for (const no in trainsRaw) {
      const t = trainsRaw[no];
      const stations = t.stations.map(s => Object.assign({}, s));
      let base = 0, prev = null;
      for (const s of stations) {
        let arr = toMin(s.sched_arr), dep = toMin(s.sched_dep);
        if (arr != null) { if (prev != null && arr + base < prev) base += 1440; arr += base; prev = arr; }
        if (dep != null) { if (prev != null && dep + base < prev) base += 1440; dep = dep + base; prev = dep; }
        s._arrMin = arr; s._depMin = dep;
      }
      trains[no] = { train_no: no, name: t.name, type: t.type, stations };
    }
    return trains;
  }

  // available recovery padding between seq r and t (Tier-0 baseline, geometry)
  function paddingAhead(stations, r, t) {
    let pad = 0;
    for (let q = r + 1; q <= t; q++) {
      const a = stations[q - 1], b = stations[q - 2];
      const gapKm = a.km - b.km;
      const pure = (gapKm / AVG_SPEED) * 60;
      const sched = a._arrMin - b._depMin;
      pad += Math.max(0, sched - pure);
    }
    return pad;
  }

  // historical lookups, backed by the tables exported in model.json
  function buildHist(lookups) {
    const g = (tbl, no, seq, dflt) => {
      const t = tbl && tbl[no]; const v = t && t[String(seq)];
      return (v != null) ? v : dflt;
    };
    return {
      stationMean: (no, seq) => g(lookups.stationDelayMean, no, seq, 0),
      segmentMean: (no, r, t) => { let s = 0, c = 0; for (let q = r + 1; q <= t; q++) { s += g(lookups.sectionAddedMean, no, q, 0); c++; } return c ? s / c : 0; },
      congMean: (no, seq) => g(lookups.congMean, no, seq, 0.4),
      precMean: (no, seq) => g(lookups.precMean, no, seq, 0),
      srMean: (no, seq) => g(lookups.srMean, no, seq, 0)
    };
  }

  // assemble the P object the views consume (mirrors the previous shape)
  function build() {
    const model = RC.model, metrics = RC.metrics, api = RC.modelapi;
    const trainsIdx = indexTrains(RC.data.trains);
    const scaler = { mean: model.scaler_mean, std: model.scaler_scale };
    const buildFull = raw => F.designRow(raw, scaler);
    const hist = buildHist(model.lookups);

    // per-point held-out predictions for the diagnostics plots
    const pred = metrics.test.pred, act = metrics.test.actual;
    const errs = pred.map((p, i) => p - act[i]);
    const deployedEval = Object.assign({}, metrics.tiers.full, { preds: pred, acts: act, errs });

    const mq = metrics.modelQuality;
    const deployed = Object.assign({}, mq, {
      predict: x => api.predict(x), _invFn: v => api.invTransform(v)
    });

    const P = {
      trainsIdx, hist, buildFull, paddingAhead, scaler,
      sigmaByLead: api.sigmaByLead,
      models: { deployed, chosen: metrics.chosen },
      coefTable: metrics.coefTable,
      metrics: {
        static: metrics.tiers.static, simple: metrics.tiers.simple,
        full: metrics.tiers.full, logM: metrics.tiers.logM, deployed: deployedEval,
        coverage: metrics.coverage,
        nTrain: metrics.split.nTrain, nTest: metrics.split.nTest,
        splitDate: metrics.split.splitDate,
        trainDateCount: metrics.split.trainDateCount, testDateCount: metrics.split.testDateCount,
        leadStatic: metrics.leadStatic, leadSimple: metrics.leadSimple, leadFull: metrics.leadFull,
        maeByType: metrics.maeByType,
        improveSimpleVsStatic: metrics.improve.simpleVsStatic,
        improveFullVsStatic: metrics.improve.fullVsStatic,
        improveFullVsSimple: metrics.improve.fullVsSimple
      }
    };
    return P;
  }

  RC.assemble = { build };
})(this);
