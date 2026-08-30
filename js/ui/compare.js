/* ============================================================================
 * ui/compare.js — Baseline Comparison
 * ----------------------------------------------------------------------------
 * Canvas line chart: MAE (minutes) vs stations-ahead for the three tiers, plus
 * a summary strip with overall test MAE per tier and % improvement over the
 * static baseline. This comparison is the core of the pitch.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  let P, mount;

  function drawChart() {
    const m = P.metrics, ch = RC.charts, col = ch.C();
    const canvas = mount.querySelector('#cmp-canvas');
    if (!canvas) return;
    const mk = (arr) => arr.map(d => ({ x: d.lead, y: d.mae }));
    const series = [
      { name: 'Tier 0 · static schedule', color: col.baseline, points: mk(m.leadStatic) },
      { name: 'Tier 1 · simple regression', color: col.sev2, points: mk(m.leadSimple) },
      { name: 'Tier 2 · multiple regression', color: col.accent, points: mk(m.leadFull), fill: true }
    ];
    ch.lineChart(canvas, series, {
      y0: 0, xstep: 1, xlabel: 'Stations ahead (lead time)', ylabel: 'Test MAE (minutes)',
      aria: `Line chart of mean absolute error in minutes versus stations ahead. ` +
        series.map(s => `${s.name}: ` + s.points.map(p => `${p.y.toFixed(1)} at ${p.x}`).join(', ')).join('. ')
    });
  }

  function render(P_, mount_) {
    P = P_; mount = mount_;
    const m = P.metrics;
    const impSimple = (m.improveSimpleVsStatic * 100).toFixed(1);
    const impFull = (m.improveFullVsStatic * 100).toFixed(1);
    const impFullSimple = (m.improveFullVsSimple * 100).toFixed(1);

    mount.innerHTML = `
      <div class="view-head">
        <h2>Baseline Comparison</h2>
        <p>All three tiers evaluated on the same date-split held-out set. Headline metric is <strong>MAE in minutes</strong> — what an operator feels. RMSE is reported too and weights large errors more heavily.</p>
      </div>
      <div class="card">
        <h3>Held-out test performance</h3>
        <div class="sub">Split by date: trained on the first ${m.trainDateCount} days, tested on the last ${m.testDateCount} days (from ${m.splitDate}). No random shuffling — that would leak the future into the past.</div>
        <div class="stat-row">
          <div class="stat"><div class="k">Tier 0 · Static</div><div class="v">${m.static.mae.toFixed(2)}<small> min MAE</small></div><div class="d" style="color:var(--baseline)">RMSE ${m.static.rmse.toFixed(2)} · today's method</div></div>
          <div class="stat"><div class="k">Tier 1 · Simple</div><div class="v">${m.simple.mae.toFixed(2)}<small> min MAE</small></div><div class="d pos">▼ ${impSimple}% vs static</div></div>
          <div class="stat" style="border-color:var(--accent)"><div class="k" style="color:var(--accent)">Tier 2 · Multiple</div><div class="v">${m.deployed.mae.toFixed(2)}<small> min MAE</small></div><div class="d pos">▼ ${impFull}% vs static · ▼ ${impFullSimple}% vs simple</div></div>
          <div class="stat"><div class="k">Tier 2 · RMSE</div><div class="v">${m.deployed.rmse.toFixed(2)}<small> min</small></div><div class="d">R²=${P.models.deployed.r2.toFixed(3)}</div></div>
        </div>
      </div>
      <div class="card">
        <h3>MAE by lead time</h3>
        <div class="sub">Error grows with how far ahead we forecast — for every tier — but the multiple-regression gap over the static baseline widens with distance, which is exactly where operators need help.</div>
        <div class="chart-legend" aria-hidden="true">
          <span><i style="background:var(--baseline)"></i> Tier 0 · static</span>
          <span><i style="background:var(--sev-2)"></i> Tier 1 · simple</span>
          <span><i style="background:var(--accent)"></i> Tier 2 · multiple</span>
        </div>
        <figure class="chart-box tall"><canvas id="cmp-canvas"></canvas>
          <figcaption>Lower is better. Model (accent) stays well below the static baseline (grey) at every lead time.</figcaption>
        </figure>
      </div>
      <div class="note"><strong>Reading it:</strong> the static schedule can only subtract fixed recovery padding from the current delay, so it degrades quickly once a train is running late. Tier 2 uses congestion, preceding-train delay, section history and recovery slack to hold error roughly flat across the near term.</div>
    `;
    drawChart();
  }

  RC.ui = RC.ui || {};
  RC.ui.compare = { render, redraw: drawChart };
})(this);
