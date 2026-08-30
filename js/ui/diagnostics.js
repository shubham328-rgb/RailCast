/* ============================================================================
 * ui/diagnostics.js — Model Diagnostics (honest ones)
 * ----------------------------------------------------------------------------
 * Residuals vs fitted (funnel = heteroscedasticity), normal Q-Q, residual
 * histogram, predicted-vs-actual with a 45° line, observed interval coverage,
 * and MAE broken down by train type and by lead time. All on the held-out set.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  let P, mount;

  function drawAll() {
    const ev = P.metrics.deployed, ch = RC.charts, col = ch.C();
    // test residuals (actual − predicted) and fitted (predicted)
    const fitted = ev.preds, resid = ev.errs.map(e => -e);

    const rvf = mount.querySelector('#dg-rvf');
    if (rvf) ch.scatter(rvf, fitted.map((f, i) => ({ x: f, y: resid[i] })), {
      ref: 'zero', symmetricY: true, color: col.accent, alpha: 0.35, dot: 1.6,
      xlabel: 'Fitted delay (min)', ylabel: 'Residual (min)',
      aria: 'Residuals versus fitted values. A rightward-opening funnel indicates error variance growing with predicted delay (heteroscedasticity).'
    });

    const qq = mount.querySelector('#dg-qq');
    if (qq) ch.qqPlot(qq, resid, {});

    const hist = mount.querySelector('#dg-hist');
    if (hist) ch.histogram(hist, resid, { color: col.accent, bins: 30,
      xlabel: 'Residual (min)', ylabel: 'Count',
      aria: 'Histogram of held-out residuals, roughly centred on zero with a mild right tail.' });

    const pva = mount.querySelector('#dg-pva');
    if (pva) ch.scatter(pva, ev.acts.map((a, i) => ({ x: a, y: ev.preds[i] })), {
      ref: 'diagonal', color: col.sev1, alpha: 0.35, dot: 1.6, x0: 0,
      xlabel: 'Actual delay (min)', ylabel: 'Predicted delay (min)',
      aria: 'Predicted versus actual delay with a 45-degree reference line; tighter clustering on the line is better.'
    });

    // MAE by lead mini-chart
    const lead = mount.querySelector('#dg-lead');
    if (lead) ch.lineChart(lead, [{ name: 'MAE by lead', color: col.accent, points: P.metrics.leadFull.map(d => ({ x: d.lead, y: d.mae })) }],
      { y0: 0, xstep: 1, xlabel: 'Stations ahead', ylabel: 'MAE (min)', aria: 'MAE rising with lead time.' });
  }

  function render(P_, mount_) {
    P = P_; mount = mount_;
    const m = P.metrics, dm = P.models.deployed;
    const cov = (m.coverage * 100).toFixed(1);
    const covClass = m.coverage >= 0.93 ? 'pos' : 'neg';

    const typeRows = m.maeByType.map(t => `<tr><td class="name">${t.type}</td><td>${t.mae.toFixed(2)}</td><td>${t.n}</td></tr>`).join('');
    const leadRows = m.leadFull.map(l => `<tr><td class="name">${l.lead} stop${l.lead > 1 ? 's' : ''}</td><td>${l.mae.toFixed(2)}</td><td>${l.n}</td></tr>`).join('');

    mount.innerHTML = `
      <div class="view-head">
        <h2>Model Diagnostics</h2>
        <p>Where the model is honest about itself. All plots use the date-split held-out set and the deployed <strong>${P.models.chosen}-target</strong> specification.</p>
      </div>

      <div class="card">
        <h3>Prediction-interval coverage (observed, not assumed)</h3>
        <div class="sub">Fraction of held-out actual arrivals that fell inside the model's 95% prediction interval. We report the measured number.</div>
        <div class="stat-row">
          <div class="stat"><div class="k">Observed 95% coverage</div><div class="v ${covClass}">${cov}%</div><div class="d">target 95.0% · n=${m.nTest.toLocaleString()}</div></div>
          <div class="stat"><div class="k">Residual std error</div><div class="v">${dm.sigma.toFixed(2)}<small> min</small></div><div class="d">on training fit</div></div>
          <div class="stat"><div class="k">Test MAE</div><div class="v">${m.deployed.mae.toFixed(2)}<small> min</small></div><div class="d">RMSE ${m.deployed.rmse.toFixed(2)}</div></div>
          <div class="stat"><div class="k">Test RMSE &gt; MAE</div><div class="v">${(m.deployed.rmse - m.deployed.mae).toFixed(2)}<small> min gap</small></div><div class="d">a few large misses</div></div>
        </div>
        <div class="note">Coverage a little under 95% is consistent with the funnel below: a single homoscedastic σ slightly under-covers the high-delay tail. A weighted or quantile approach would tighten this — see the residuals-vs-fitted plot.</div>
      </div>

      <div class="grid-2">
        <div class="card"><h3>Residuals vs fitted</h3><div class="sub">Look for a funnel — variance rising with predicted delay.</div>
          <figure class="chart-box"><canvas id="dg-rvf"></canvas><figcaption>Right-opening spread = heteroscedasticity. Discussed honestly in the README.</figcaption></figure></div>
        <div class="card"><h3>Normal Q-Q of residuals</h3><div class="sub">Points on the diagonal ⇒ normal residuals.</div>
          <figure class="chart-box"><canvas id="dg-qq"></canvas><figcaption>Upper-right lift indicates a heavier right tail — the skew that survives the fit.</figcaption></figure></div>
        <div class="card"><h3>Residual histogram</h3><div class="sub">Centred near zero; mild right skew.</div>
          <figure class="chart-box"><canvas id="dg-hist"></canvas><figcaption>Held-out residuals (actual − predicted), minutes.</figcaption></figure></div>
        <div class="card"><h3>Predicted vs actual</h3><div class="sub">45° line = perfect prediction.</div>
          <figure class="chart-box"><canvas id="dg-pva"></canvas><figcaption>Tight clustering on the diagonal across the delay range.</figcaption></figure></div>
      </div>

      <div class="grid-2">
        <div class="card"><h3>MAE by train type</h3><div class="sub">Held-out MAE, minutes.</div>
          <div class="tbl-wrap"><table class="data"><thead><tr><th class="name">Type</th><th>MAE (min)</th><th>n</th></tr></thead><tbody>${typeRows}</tbody></table></div></div>
        <div class="card"><h3>MAE by lead time</h3><div class="sub">Error grows with how far ahead we forecast.</div>
          <figure class="chart-box"><canvas id="dg-lead" style="height:180px"></canvas></figure>
          <div class="tbl-wrap"><table class="data"><thead><tr><th class="name">Lead</th><th>MAE (min)</th><th>n</th></tr></thead><tbody>${leadRows}</tbody></table></div></div>
      </div>`;
    drawAll();
  }

  RC.ui = RC.ui || {};
  RC.ui.diagnostics = { render, redraw: drawAll };
})(this);
