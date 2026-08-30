/* ============================================================================
 * ui/timeline.js — Live Journey Timeline (primary demo view)
 * ----------------------------------------------------------------------------
 * Vertical route. Passed stops show actual arrival + delay. Remaining stops
 * show the model's predicted clock time, a 95% prediction-interval band, the
 * static-schedule prediction alongside in a muted tone, and severity colour.
 * A step-forward control advances the train stop by stop; intervals visibly
 * narrow as the destination approaches.
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;

  let P, mount, liveIdx = 0, refSeq = 1;

  function stopRow(s, scaleMax) {
    const f = RC.fmt;
    const el = document.createElement('div');
    let cls = 'stop ' + s.role;
    if (s.role === 'future') cls += ' sev-' + s.sev;
    el.className = cls;

    const meta = `<div class="st-meta">
      <div class="code">${s.code}</div>
      <div class="name">${s.name}</div>
      <div class="km mono">${s.km} km${s.halt ? ' · halt ' + s.halt + 'm' : ''}</div>
    </div>`;

    let body = '<div class="st-body">';
    if (s.role === 'passed') {
      body += `<div class="row"><span class="clock">${f.fmtClock(s.schedArrMin)}</span>
        <span class="chip">scheduled</span></div>
        <div class="interval-line">passed</div>`;
    } else if (s.role === 'current') {
      body += `<div class="row"><span class="clock">${f.fmtClock((s.schedArrMin != null ? s.schedArrMin : s.schedDepMin) + s.actualDelay)}</span>
        <span class="chip actual sev-${s.sev}">running ${f.fmtDelay(s.actualDelay)}</span>
        <span class="chip">last reported</span></div>
        <div class="interval-line">forecasting from here →</div>`;
    } else {
      const sevName = s.sev === 1 ? 'on time' : s.sev === 2 ? 'moderate' : 'severe';
      body += `<div class="row">
        <span class="clock">${f.fmtClock(s.predArrMin)}</span>
        <span class="chip sev-${s.sev}">${sevName} · ${f.fmtDelay(s.predDelay)}</span>
      </div>`;
      body += `<div class="interval-line"><span class="model">model</span> 95% ${f.fmtClock(s.loArrMin)}–${f.fmtClock(s.hiArrMin)}
        &nbsp;·&nbsp; <span class="base">static</span> ${f.fmtClock(s.staticArrMin)} (${f.fmtDelay(s.staticDelay)})</div>`;
      // band
      const clamp = v => Math.max(0, Math.min(1, v / scaleMax));
      const lo = clamp(s.lo), hi = clamp(s.hi), pt = clamp(s.predDelay), st = clamp(s.staticDelay);
      body += `<div class="band" title="prediction interval">
        <div class="fill" style="left:${lo * 100}%;width:${Math.max(1.5, (hi - lo) * 100)}%"></div>
        <div class="base-pt" style="left:${st * 100}%" title="static baseline"></div>
        <div class="pt" style="left:${pt * 100}%" title="model point estimate"></div>
      </div>`;
    }
    body += '</div>';
    el.innerHTML = meta + body;
    return el;
  }

  function draw() {
    const live = P.live[liveIdx];
    const currentDelay = live.actualDelay[refSeq];
    const stops = RC.app.forecast(P, live.train_no, refSeq, currentDelay, P.today);
    const futures = stops.filter(s => s.role === 'future');
    const scaleMax = Math.max(30, ...futures.map(s => s.hi));

    const tl = mount.querySelector('#timeline');
    tl.innerHTML = '';
    stops.forEach(s => tl.appendChild(stopRow(s, scaleMax)));

    // update stepper state + readout
    const nSt = P.trainsIdx[live.train_no].stations.length;
    mount.querySelector('#btn-prev').disabled = refSeq <= 1;
    mount.querySelector('#btn-next').disabled = refSeq >= nSt - 1;
    const dest = stops[stops.length - 1];
    mount.querySelector('#readout').innerHTML =
      `At <strong>${stops[refSeq - 1].code}</strong> · ${RC.fmt.fmtDelay(currentDelay)} · ` +
      `${nSt - refSeq} stops to run · destination <strong>${dest.code}</strong> ETA ` +
      `<span class="mono">${RC.fmt.fmtClock(dest.predArrMin)}</span> ` +
      `<span style="color:var(--ink-faint)">(±${Math.round((dest.hi - dest.lo) / 2)}m)</span>`;
  }

  function render(P_, mount_) {
    P = P_; mount = mount_;
    const opts = P.live.map((L, i) => {
      const t = P.trainsIdx[L.train_no];
      return `<option value="${i}">${L.train_no} · ${t.name} (${t.type})</option>`;
    }).join('');

    mount.innerHTML = `
      <div class="view-head">
        <h2>Live Journey Timeline</h2>
        <p>Dynamic ETA for a running train. The model predicts delay at every remaining stop with a 95% prediction interval; the static-schedule baseline (what Indian Railways computes today) is shown alongside in a muted tone. Step the train forward and watch the interval narrow.</p>
      </div>
      <div class="journey">
        <div class="journey-controls">
          <div class="card">
            <label for="train-select" class="sub" style="display:block">Running train (held-out day: <span id="gt-date" class="mono"></span>)</label>
            <select id="train-select" class="train-select" aria-label="Select running train">${opts}</select>
            <div class="stepper" role="group" aria-label="Advance train">
              <button id="btn-prev" aria-label="Step back one station">◀ Back</button>
              <button id="btn-next" class="primary" aria-label="Step forward one station">Advance ▶</button>
            </div>
            <button id="btn-reset" class="stepper" style="width:100%;display:block;text-align:center" aria-label="Reset to reported position">Reset</button>
            <div id="readout" class="note" style="margin-top:var(--s-4)"></div>
            <div class="legend" style="margin-top:var(--s-4)">
              <div><span class="swatch model"></span> model prediction (accent)</div>
              <div><span class="swatch base"></span> static-schedule baseline</div>
              <div><span class="swatch band"></span> 95% prediction interval</div>
              <div style="margin-top:var(--s-3);color:var(--ink-faint)">Severity: <span style="color:var(--sev-1)">●</span> &lt;10m <span style="color:var(--sev-2)">●</span> 10–30m <span style="color:var(--sev-3)">●</span> &gt;30m</div>
            </div>
          </div>
        </div>
        <div class="card">
          <div id="timeline" class="timeline"></div>
        </div>
      </div>`;

    const sel = mount.querySelector('#train-select');
    function reset() { liveIdx = +sel.value; refSeq = P.live[liveIdx].refSeq; mount.querySelector('#gt-date').textContent = P.live[liveIdx].groundTruthDate; draw(); }
    sel.addEventListener('change', reset);
    mount.querySelector('#btn-next').addEventListener('click', () => { const nSt = P.trainsIdx[P.live[liveIdx].train_no].stations.length; if (refSeq < nSt - 1) { refSeq++; draw(); } });
    mount.querySelector('#btn-prev').addEventListener('click', () => { if (refSeq > 1) { refSeq--; draw(); } });
    mount.querySelector('#btn-reset').addEventListener('click', () => { refSeq = P.live[liveIdx].refSeq; draw(); });
    reset();
  }

  RC.ui = RC.ui || {};
  RC.ui.timeline = { render };
})(this);
