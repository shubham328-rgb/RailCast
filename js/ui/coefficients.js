/* ============================================================================
 * ui/coefficients.js — Coefficient Table (the Q&A insurance)
 * ----------------------------------------------------------------------------
 * A real regression output: predictor, coefficient, std error, t, p, VIF.
 * Sorted by |t|. Significance flagged at p<0.05. Each significant coefficient
 * gets a plain-English interpretation line. VIF>5 flagged as multicollinearity.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  let P, mount;

  const pretty = { current_delay_min: 'current delay', stations_ahead: 'stations ahead',
    km_remaining: 'km remaining', halt_minutes_ahead: 'halt minutes ahead', padding_ratio: 'padding ratio',
    hist_delay_mean: 'historic delay at stop', hist_section_delay_mean: 'historic section delay',
    section_congestion_idx: 'section congestion', preceding_train_delay_min: 'preceding-train delay',
    speed_restriction_km: 'speed restriction (km)', delay_x_stations_ahead: 'delay × stations ahead',
    delay_x_padding_ratio: 'delay × padding ratio', sqrt_km_remaining: '√km remaining', delay_squared: 'delay²',
    is_monsoon: 'monsoon (Jun–Sep)', is_night_run: 'night run', type_rajdhani: 'type: Rajdhani',
    type_superfast: 'type: Superfast', type_express: 'type: Express', dow_mon: 'Monday', dow_tue: 'Tuesday',
    dow_wed: 'Wednesday', dow_thu: 'Thursday', dow_fri: 'Friday', dow_sat: 'Saturday', intercept: 'intercept' };

  function interpret(c) {
    const b = c.beta, dir = b >= 0 ? 'adds' : 'removes', mag = Math.abs(b).toFixed(2);
    if (c.kind === 'c') {
      const per = Math.abs(c.perUnit).toFixed(2);
      return `Each +1 SD (${c.sd.toFixed(1)} units) of ${pretty[c.name]} ${dir} ${mag} min of predicted delay (≈${per} min per unit), holding all else constant.`;
    }
    if (c.kind === 'd') {
      return `Being ${pretty[c.name]} ${dir} ${mag} min versus the reference level, all else equal.`;
    }
    return `Baseline predicted delay is ${b.toFixed(2)} min when every standardised predictor sits at its mean.`;
  }

  function render(P_, mount_) {
    P = P_; mount = mount_;
    const rows = P.coefTable.slice().sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
    const dm = P.models.deployed;

    let body = '';
    rows.forEach(c => {
      const sig = c.p < 0.05 && c.name !== 'intercept';
      const vifHi = isFinite(c.vif) && c.vif > 5;
      const betaCls = c.name === 'intercept' ? '' : (c.beta >= 0 ? 'pos-beta' : 'neg-beta');
      body += `<tr class="${sig ? 'sig' : ''}">
        <td class="name">${pretty[c.name] || c.name}${c.name === 'intercept' ? '' : ` <span style="color:var(--ink-faint)">${c.kind === 'd' ? 'dummy' : 'std'}</span>`}</td>
        <td class="${betaCls}">${c.beta >= 0 ? '+' : ''}${c.beta.toFixed(3)}</td>
        <td>${c.se.toFixed(3)}</td>
        <td>${c.t.toFixed(2)}</td>
        <td>${c.p < 0.0001 ? '&lt;0.0001' : c.p.toFixed(4)}</td>
        <td>${c.name === 'intercept' ? '—' : (isFinite(c.vif) ? `<span class="badge ${vifHi ? 'vif-hi' : 'vif-ok'}">${c.vif.toFixed(2)}</span>` : '∞')}</td>
        <td>${c.name === 'intercept' ? '' : `<span class="badge ${sig ? 'sig' : 'ns'}">${sig ? 'p<0.05' : 'n.s.'}</span>`}</td>
      </tr>`;
      if (sig || c.name === 'intercept') body += `<tr><td class="interp" colspan="7">${interpret(c)}</td></tr>`;
    });

    const nSig = rows.filter(c => c.p < 0.05 && c.name !== 'intercept').length;
    const nVif = rows.filter(c => isFinite(c.vif) && c.vif > 5).length;

    mount.innerHTML = `
      <div class="view-head">
        <h2>Coefficient Table</h2>
        <p>Full OLS output on the deployed <strong>${P.models.chosen}-target</strong> model. Continuous predictors are standardised, so β is the effect of a one-standard-deviation change. Sorted by |t|. Every number here is computed from the fit, not hardcoded.</p>
      </div>
      <div class="card">
        <div class="stat-row" style="margin-bottom:var(--s-4)">
          <div class="stat"><div class="k">R²</div><div class="v">${dm.r2.toFixed(3)}</div><div class="d">adj ${dm.adjR2.toFixed(3)}</div></div>
          <div class="stat"><div class="k">F-statistic</div><div class="v">${dm.F.toFixed(0)}</div><div class="d">df ${dm.dfModel}, ${dm.dfResid} · p≈0</div></div>
          <div class="stat"><div class="k">Residual std err</div><div class="v">${dm.sigma.toFixed(2)}<small> min</small></div><div class="d">n=${dm.n.toLocaleString()}</div></div>
          <div class="stat"><div class="k">Significant</div><div class="v">${nSig}<small> / ${rows.length - 1}</small></div><div class="d">${nVif ? nVif + ' with VIF>5' : 'no VIF>5'}</div></div>
        </div>
        <div class="tbl-wrap">
          <table class="data">
            <thead><tr>
              <th class="name">Predictor</th><th>β</th><th>Std err</th><th>t</th><th>p-value</th><th>VIF</th><th>Sig.</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div class="note warn"><strong>Multicollinearity:</strong> VIF above 5 is flagged in red. Here it appears where a variable and its own transform coexist by design — e.g. <span class="mono">km remaining</span> with <span class="mono">√km remaining</span>, and <span class="mono">current delay</span> with <span class="mono">delay²</span> / the interaction terms. This inflates those standard errors but does not bias the coefficients or hurt prediction; the terms are kept because they materially improve held-out MAE. Dropping either partner is the fix if inference on that single coefficient is the goal.</div>
      </div>`;
  }

  RC.ui = RC.ui || {};
  RC.ui.coefficients = { render };
})(this);
