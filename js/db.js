/* ============================================================================
 * db.js — Supabase data layer (plain fetch against the REST API; no SDK, no CDN)
 * ----------------------------------------------------------------------------
 * loadAll()      — pull the catalog, live trains and model/metrics from the DB
 *                  and overwrite the embedded RC.data.* / RC.model / RC.metrics.
 *                  On ANY problem (not configured, offline, blocked) it silently
 *                  keeps the embedded data, so the app never breaks.
 * saveLiveDelay()— upsert an admin-entered delay into live_trains (shared).
 *
 * Uses the Supabase REST endpoint (PostgREST): GET/POST /rest/v1/<table>.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  const cfg = RC.dbConfig || {};
  const configured = /^https:\/\/.+\.supabase\.co/.test(cfg.url || '') &&
                     (cfg.anonKey || '').length > 20 && !/YOUR/.test(cfg.anonKey || '');

  const headers = () => ({
    apikey: cfg.anonKey,
    Authorization: 'Bearer ' + cfg.anonKey,
    'Content-Type': 'application/json'
  });
  const rest = path => cfg.url.replace(/\/$/, '') + '/rest/v1/' + path;

  async function getJson(path) {
    const res = await fetch(rest(path), { headers: headers() });
    if (!res.ok) throw new Error('GET ' + path + ' -> ' + res.status);
    return res.json();
  }

  // rebuild RC.data.trains { no: {name,type,stations:[...]} } from two tables
  function assembleTrains(trainRows, stationRows) {
    const byTrain = {};
    trainRows.forEach(t => { byTrain[t.train_no] = { name: t.name, type: t.type, stations: [] }; });
    stationRows.forEach(s => {
      const t = byTrain[s.train_no]; if (!t) return;
      t.stations.push({ code: s.code, name: s.name, seq: s.seq, km: s.km,
        sched_arr: s.sched_arr, sched_dep: s.sched_dep, halt_min: s.halt_min });
    });
    Object.values(byTrain).forEach(t => t.stations.sort((a, b) => a.seq - b.seq));
    return byTrain;
  }

  function assembleLive(rows, trains) {
    return rows.map(r => {
      let actual = r.actual_delay;
      // admin-created rows may have no ground-truth journey — fill so the
      // step-forward timeline can't crash (constant delay past the report point)
      if (!actual || typeof actual !== 'object') {
        actual = {};
        const n = (trains[r.train_no] && trains[r.train_no].stations.length) || 0;
        for (let s = 1; s <= n; s++) actual[s] = r.current_delay_min;
      }
      return {
        train_no: r.train_no, run_date: r.run_date,
        last_reported_station_seq: r.last_reported_station_seq,
        refSeq: r.ref_seq != null ? r.ref_seq : r.last_reported_station_seq,
        current_delay_min: r.current_delay_min, reported_at_epoch: r.reported_at_epoch,
        groundTruthDate: r.ground_truth_date, actualDelay: actual, source: r.source
      };
    });
  }

  async function loadAll() {
    RC.db.configured = configured;
    if (!configured) { RC.db.source = 'embedded'; return 'embedded'; }
    try {
      const [arts, trainRows, stationRows, liveRows] = await Promise.all([
        getJson('model_artifacts?select=name,data'),
        getJson('trains?select=train_no,name,type'),
        getJson('stations?select=train_no,seq,code,name,km,sched_arr,sched_dep,halt_min&order=train_no,seq'),
        getJson('live_trains?select=*&order=train_no')
      ]);
      const art = {}; arts.forEach(a => { art[a.name] = a.data; });
      if (!art.model || !art.metrics || !trainRows.length) throw new Error('empty tables — run db/seed.py');
      RC.model = art.model;
      RC.metrics = art.metrics;
      RC.data = RC.data || {};
      RC.data.trains = assembleTrains(trainRows, stationRows);
      RC.data.live = liveRows.length ? assembleLive(liveRows, RC.data.trains) : RC.data.live;
      RC.db.source = 'database';
      return 'database';
    } catch (e) {
      console.warn('[RailCast] database load failed, using embedded data:', e.message);
      RC.db.source = 'embedded (db unreachable)';
      return 'embedded';
    }
  }

  // upsert one admin-entered delay so every viewer sees it (shared live board)
  async function saveLiveDelay(trainNo, refSeq, currentDelay) {
    if (!configured) throw new Error('database not configured');
    const row = {
      train_no: trainNo, ref_seq: refSeq, last_reported_station_seq: refSeq,
      current_delay_min: currentDelay, reported_at_epoch: Math.round(Date.now() / 1000),
      source: 'live', updated_at: new Date().toISOString()
    };
    const res = await fetch(rest('live_trains?on_conflict=train_no'), {
      method: 'POST',
      headers: Object.assign(headers(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row)
    });
    if (!res.ok) throw new Error('save failed: ' + res.status + ' ' + (await res.text()).slice(0, 120));
    return true;
  }

  RC.db = { loadAll, saveLiveDelay, configured, source: 'embedded' };
})(this);
