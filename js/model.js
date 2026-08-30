/* ============================================================================
 * model.js — thin inference over the model fitted in Python (ml/train.py)
 * ----------------------------------------------------------------------------
 * The browser does NO fitting and computes NO statistics. It loads model.json
 * (as RC.model) and only: standardises features, takes a dot product with the
 * coefficients, applies the inverse target transform, and forms the prediction
 * interval from the exported residual_std_error and xtx_inv_diag. No matrix
 * algebra. Every statistic on screen comes from Python via metrics.json.
 * ========================================================================== */
(function (global) {
  'use strict';
  const M = global.RC.model;                       // the exported model.json object
  const betaFull = [M.intercept].concat(M.coef);   // [intercept, β₁ … βₖ]

  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  // inverse of the target transform (raw ⇒ identity, log ⇒ expm1)
  const invTransform = v => (M.target === 'log' ? Math.expm1(v) : v);

  // xFull is the design row [1, standardised/dummy features…] (length k+1)
  const predictRaw = xFull => dot(betaFull, xFull);
  const predict = xFull => invTransform(predictRaw(xFull));

  // 95% prediction interval: ŷ ± z·σ·√(1 + Σ xⱼ²·(XᵀX)⁻¹ⱼⱼ). σ may be the
  // lead-time-conditional residual scale (heteroscedasticity-aware); the leverage
  // term uses the exported diagonal of (XᵀX)⁻¹ (its off-diagonals are negligible
  // next to the "1 +" here). Returns interval endpoints already back-transformed.
  function predictionInterval(xFull, sigma) {
    const s = (sigma != null) ? sigma : M.residual_std_error;
    let lev = 0; const d = M.xtx_inv_diag;
    for (let j = 0; j < xFull.length; j++) lev += xFull[j] * xFull[j] * d[j];
    const half = M.z95 * s * Math.sqrt(1 + lev);
    const c = predictRaw(xFull);
    return { yhat: invTransform(c), lo: invTransform(c - half), hi: invTransform(c + half) };
  }

  // lead-time-conditional residual scale (falls back to the global σ)
  const sigmaByLead = k => {
    const v = M.residual_std_by_lead && M.residual_std_by_lead[String(k)];
    return (v != null) ? v : M.residual_std_error;
  };

  global.RC.modelapi = { predict, predictRaw, invTransform, predictionInterval, sigmaByLead, betaFull };
})(this);
