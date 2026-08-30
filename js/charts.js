/* ============================================================================
 * charts.js — Canvas 2D chart primitives (no charting library)
 * ----------------------------------------------------------------------------
 * Every chart: retina-crisp (devicePixelRatio), theme-aware (reads CSS custom
 * properties), and accessible (role="img" + an aria-label text alternative
 * describing the data, per the brief).
 * ========================================================================== */
(function (global) {
  'use strict';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Inverse standard normal (Acklam) — used only to place Q-Q theoretical
  // quantiles. This is display maths, not model fitting.
  function normInv(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
               -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425; let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p <= 1 - pl) { q = p - 0.5; r = q*q;
      return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
    } else { q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
  }
  const C = () => ({
    ink: cssVar('--ink'), muted: cssVar('--ink-muted'), faint: cssVar('--ink-faint'),
    grid: cssVar('--grid'), accent: cssVar('--accent'), baseline: cssVar('--baseline'),
    sev1: cssVar('--sev-1'), sev2: cssVar('--sev-2'), sev3: cssVar('--sev-3'),
    surface: cssVar('--surface'), ok: cssVar('--ok')
  });

  function setup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(80, Math.round(rect.height));
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function aria(canvas, label) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
  }
  function niceStep(range, target) {
    const raw = range / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }
  function fmt(n) { return Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1); }

  /* Shared axis frame. domain {x0,x1,y0,y1}. Returns scale fns + plot rect. */
  function frame(ctx, w, h, dom, opts) {
    const col = C();
    const pad = Object.assign({ l: 46, r: 14, t: 14, b: 34 }, opts.pad || {});
    const px = x => pad.l + (x - dom.x0) / (dom.x1 - dom.x0) * (w - pad.l - pad.r);
    const py = y => h - pad.b - (y - dom.y0) / (dom.y1 - dom.y0) * (h - pad.t - pad.b);
    ctx.font = '11px ' + cssVar('--font');
    ctx.textBaseline = 'middle';
    // y grid + labels
    const ystep = niceStep(dom.y1 - dom.y0, 5);
    ctx.strokeStyle = col.grid; ctx.fillStyle = col.muted; ctx.lineWidth = 1;
    for (let y = Math.ceil(dom.y0 / ystep) * ystep; y <= dom.y1 + 1e-9; y += ystep) {
      const Y = py(y);
      ctx.beginPath(); ctx.moveTo(pad.l, Y); ctx.lineTo(w - pad.r, Y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(y), pad.l - 6, Y);
    }
    // x labels
    ctx.textAlign = 'center';
    const xstep = opts.xstep || niceStep(dom.x1 - dom.x0, 6);
    for (let x = Math.ceil(dom.x0 / xstep) * xstep; x <= dom.x1 + 1e-9; x += xstep) {
      ctx.fillStyle = col.muted;
      ctx.fillText(opts.xfmt ? opts.xfmt(x) : fmt(x), px(x), h - pad.b + 14);
    }
    // axis titles
    ctx.fillStyle = col.faint;
    if (opts.xlabel) { ctx.textAlign = 'center'; ctx.fillText(opts.xlabel, pad.l + (w - pad.l - pad.r) / 2, h - 4); }
    if (opts.ylabel) {
      ctx.save(); ctx.translate(11, pad.t + (h - pad.t - pad.b) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.fillText(opts.ylabel, 0, 0); ctx.restore();
    }
    return { px, py, pad, col };
  }

  // color string -> rgba with alpha (handles #hex and rgb()/rgba())
  function withAlpha(c, a) {
    c = (c || '').trim();
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      const n = parseInt(h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return c;
  }

  /* Multi-series line chart. series: [{name,color,points:[{x,y}],fill}] */
  function lineChart(canvas, series, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    let x0 = Infinity, x1 = -Infinity, y0 = 0, y1 = -Infinity;
    series.forEach(s => s.points.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }));
    if (opts.y0 != null) y0 = opts.y0;
    y1 = (opts.y1 != null) ? opts.y1 : y1 * 1.12 + 0.5;
    if (x0 === x1) x1 = x0 + 1;
    const F = frame(ctx, w, h, { x0, x1, y0, y1 }, opts);
    const baseY = F.py(y0);
    series.forEach(s => {
      // gradient area fill under the line (optional)
      if (s.fill) {
        const grad = ctx.createLinearGradient(0, F.pad.t, 0, baseY);
        grad.addColorStop(0, withAlpha(s.color, 0.28));
        grad.addColorStop(1, withAlpha(s.color, 0));
        ctx.fillStyle = grad; ctx.beginPath();
        s.points.forEach((p, i) => { const X = F.px(p.x), Y = F.py(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.lineTo(F.px(s.points[s.points.length - 1].x), baseY);
        ctx.lineTo(F.px(s.points[0].x), baseY);
        ctx.closePath(); ctx.fill();
      }
      // line with a soft glow
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = withAlpha(s.color, 0.6); ctx.shadowBlur = 6;
      ctx.beginPath();
      s.points.forEach((p, i) => { const X = F.px(p.x), Y = F.py(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke(); ctx.shadowBlur = 0;
      // points: outer glow dot + inner core
      s.points.forEach(p => {
        const X = F.px(p.x), Y = F.py(p.y);
        ctx.fillStyle = withAlpha(s.color, 0.25); ctx.beginPath(); ctx.arc(X, Y, 5, 0, 7); ctx.fill();
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X, Y, 3, 0, 7); ctx.fill();
        ctx.fillStyle = F.col.surface; ctx.beginPath(); ctx.arc(X, Y, 1.2, 0, 7); ctx.fill();
      });
    });
    aria(canvas, opts.aria || (series.map(s => s.name + ' series').join(', ')));
  }

  /* Scatter with optional 45° or horizontal reference line. */
  function scatter(canvas, pts, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    if (opts.symmetricY) { const m = Math.max(Math.abs(y0), Math.abs(y1)); y0 = -m; y1 = m; }
    const padY = (y1 - y0) * 0.08 + 0.5, padX = (x1 - x0) * 0.04 + 0.5;
    const dom = { x0: x0 - padX, x1: x1 + padX, y0: y0 - padY, y1: y1 + padY };
    if (opts.x0 != null) dom.x0 = opts.x0;
    const F = frame(ctx, w, h, dom, opts);
    // reference line
    if (opts.ref === 'diagonal') {
      ctx.strokeStyle = F.col.faint; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      const lo = Math.max(dom.x0, dom.y0), hi = Math.min(dom.x1, dom.y1);
      ctx.beginPath(); ctx.moveTo(F.px(lo), F.py(lo)); ctx.lineTo(F.px(hi), F.py(hi)); ctx.stroke();
      ctx.setLineDash([]);
    } else if (opts.ref === 'zero') {
      ctx.strokeStyle = F.col.faint; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(F.px(dom.x0), F.py(0)); ctx.lineTo(F.px(dom.x1), F.py(0)); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = opts.color || F.col.accent;
    const r = opts.dot || 1.7;
    ctx.globalAlpha = opts.alpha != null ? opts.alpha : 0.45;
    pts.forEach(p => { ctx.beginPath(); ctx.arc(F.px(p.x), F.py(p.y), r, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1;
    aria(canvas, opts.aria || 'scatter plot');
  }

  /* Histogram of values. */
  function histogram(canvas, values, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    let lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (lo === hi) { lo -= 1; hi += 1; }
    const bins = opts.bins || 28;
    const bw = (hi - lo) / bins;
    const counts = new Array(bins).fill(0);
    values.forEach(v => { let k = Math.floor((v - lo) / bw); if (k >= bins) k = bins - 1; if (k < 0) k = 0; counts[k]++; });
    const maxC = Math.max.apply(null, counts);
    const F = frame(ctx, w, h, { x0: lo, x1: hi, y0: 0, y1: maxC * 1.1 }, opts);
    ctx.fillStyle = opts.color || F.col.accent;
    for (let i = 0; i < bins; i++) {
      if (!counts[i]) continue;
      const X = F.px(lo + i * bw), X2 = F.px(lo + (i + 1) * bw), Y = F.py(counts[i]), Y0 = F.py(0);
      ctx.fillRect(X + 0.5, Y, Math.max(1, X2 - X - 1), Y0 - Y);
    }
    // zero reference
    if (lo < 0 && hi > 0) { ctx.strokeStyle = F.col.faint; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(F.px(0), F.pad.t); ctx.lineTo(F.px(0), h - F.pad.b); ctx.stroke(); ctx.setLineDash([]); }
    aria(canvas, opts.aria || 'histogram');
  }

  /* Normal Q-Q plot of residuals. */
  function qqPlot(canvas, resid, opts) {
    opts = opts || {};
    const s = resid.slice().sort((a, b) => a - b);
    const n = s.length;
    let mean = 0; s.forEach(v => mean += v); mean /= n;
    let sd = 0; s.forEach(v => sd += (v - mean) * (v - mean)); sd = Math.sqrt(sd / (n - 1));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const q = (i + 0.5) / n;
      pts.push({ x: normInv(q), y: (s[i] - mean) / sd });
    }
    scatter(canvas, pts, Object.assign({ ref: 'diagonal', alpha: 0.5, dot: 1.5,
      xlabel: 'Theoretical quantiles', ylabel: 'Sample quantiles',
      aria: opts.aria || 'Q-Q plot of standardised residuals against a normal distribution; points on the dashed diagonal indicate normality' }, opts));
  }

  global.RC = global.RC || {};
  global.RC.charts = { lineChart, scatter, histogram, qqPlot, cssVar, C, normInv };
})(this);
