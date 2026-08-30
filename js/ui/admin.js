/* ============================================================================
 * ui/admin.js — Admin Console (manual what-if delay entry)
 * ----------------------------------------------------------------------------
 * An operator picks a train, the station it last reported from, and types the
 * CURRENT delay in minutes. The model immediately forecasts the delay, ETA and
 * 95% prediction interval at every remaining stop, alongside the static-schedule
 * baseline. Optional "conditions ahead" let the operator run congestion / speed
 * restriction / monsoon what-ifs. Nothing is fitted here — it calls the same
 * inference the Live Timeline uses (RC.app.forecast).
 * ========================================================================== */
(function (global) {
  'use strict';
  const RC = global.RC;
  let P, mount, trainNo, refSeq, delay, advOn = false;

  const sevName = s => s === 1 ? 'on time' : s === 2 ? 'moderate' : 'severe';

  // representative historical expectation ahead (to pre-fill the advanced inputs)
  function expectedAhead(no, r, nSt) {
    let cong = 0, prec = 0, c = 0;
    for (let q = r + 1; q <= nSt; q++) { cong += P.hist.congMean(no, q); prec += P.hist.precMean(no, q); c++; }
    return { congestion: c ? cong / c : 0.4, preceding: c ? prec / c : 0 };
  }

  function readOverrides() {
    if (!advOn) return null;
    return {
      congestion: parseFloat(mount.querySelector('#adv-cong').value),
      preceding: parseFloat(mount.querySelector('#adv-prec').value),
      speedKm: parseFloat(mount.querySelector('#adv-sr').value),
      monsoon: mount.querySelector('#adv-monsoon').checked ? 1 : 0,
      night: mount.querySelector('#adv-night').checked ? 1 : 0
    };
  }

  function recompute() {
    const f = RC.fmt;
    const stops = RC.app.forecast(P, trainNo, refSeq, delay, P.today, readOverrides());
    const futures = stops.filter(s => s.role === 'future');
    const cur = stops[refSeq - 1];
    const dest = stops[stops.length - 1];
    const worst = futures.reduce((a, b) => (b.predDelay > a.predDelay ? b : a), futures[0]);

    // headline tiles
    const tiles = `
      <div class="stat"><div class="k">Destination ${dest.code} — ETA</div>
        <div class="v mono">${f.fmtClock(dest.predArrMin)}</div>
        <div class="d">sched ${f.fmtClock(dest.schedArrMin)} · ${f.fmtDelay(dest.predDelay)}</div></div>
      <div class="stat"><div class="k">95% interval at destination</div>
        <div class="v mono">±${Math.round((dest.hi - dest.lo) / 2)}<small> min</small></div>
        <div class="d">${f.fmtClock(dest.loArrMin)}–${f.fmtClock(dest.hiArrMin)}</div></div>
      <div class="stat"><div class="k">Worst stop ahead</div>
        <div class="v">${f.fmtDelay(worst.predDelay)}</div>
        <div class="d">at ${worst.code} (${sevName(worst.sev)})</div></div>
      <div class="stat"><div class="k">Stops remaining</div>
        <div class="v">${futures.length}</div>
        <div class="d">from ${cur.code} · entered ${f.fmtDelay(delay)}</div></div>`;
    mount.querySelector('#adm-tiles').innerHTML = tiles;

    // per-stop table (current + future)
    let rows = '';
    stops.filter(s => s.role !== 'passed').forEach(s => {
      if (s.role === 'current') {
        rows += `<tr>
          <td class="name">${s.code} · ${s.name}</td>
          <td class="mono">${s.km}</td>
          <td class="mono">${f.fmtClock((s.schedArrMin != null ? s.schedArrMin : s.schedDepMin))}</td>
          <td><span class="chip sev-${s.sev}">now ${f.fmtDelay(s.actualDelay)}</span></td>
          <td class="mono">—</td><td class="mono">—</td><td class="mono">—</td></tr>`;
      } else {
        rows += `<tr>
          <td class="name">${s.code} · ${s.name}</td>
          <td class="mono">${s.km}</td>
          <td class="mono">${f.fmtClock(s.schedArrMin)}</td>
          <td><span class="chip sev-${s.sev}">${f.fmtDelay(s.predDelay)}</span></td>
          <td class="mono" style="color:var(--accent)">${f.fmtClock(s.predArrMin)}</td>
          <td class="mono">${f.fmtClock(s.loArrMin)}–${f.fmtClock(s.hiArrMin)}</td>
          <td class="mono base">${f.fmtClock(s.staticArrMin)}</td></tr>`;
      }
    });
    mount.querySelector('#adm-tbody').innerHTML = rows;
  }

  function stationOptions() {
    const st = P.trainsIdx[trainNo].stations;
    // reference station can be any stop except the last (need >=1 stop ahead)
    return st.slice(0, st.length - 1).map(s =>
      `<option value="${s.seq}">${s.seq}. ${s.code} — ${s.name}</option>`).join('');
  }

  function syncStationAndAdvanced() {
    const sel = mount.querySelector('#adm-station');
    sel.innerHTML = stationOptions();
    if (refSeq > P.trainsIdx[trainNo].stations.length - 1) refSeq = 1;
    sel.value = String(refSeq);
    // prefill advanced with expected-ahead values for this train/station
    const nSt = P.trainsIdx[trainNo].stations.length;
    const ex = expectedAhead(trainNo, refSeq, nSt);
    mount.querySelector('#adv-cong').value = ex.congestion.toFixed(2);
    mount.querySelector('#adv-cong-val').textContent = ex.congestion.toFixed(2);
    mount.querySelector('#adv-prec').value = Math.round(ex.preceding);
    mount.querySelector('#adv-sr').value = 0;
    const depHour = Math.floor((P.trainsIdx[trainNo].stations[0]._depMin % 1440) / 60);
    mount.querySelector('#adv-night').checked = (depHour >= 22 || depHour < 5);
    mount.querySelector('#adv-monsoon').checked = (P.today.month >= 6 && P.today.month <= 9);
  }

  function render(P_, mount_) {
    P = P_; mount = mount_;
    const nos = Object.keys(P.trainsIdx).sort();
    trainNo = nos[0];
    refSeq = 2; delay = 15;

    const trainOpts = nos.map(no => {
      const t = P.trainsIdx[no];
      return `<option value="${no}">${no} · ${t.name} (${t.type})</option>`;
    }).join('');

    mount.innerHTML = `
      <div class="view-head">
        <h2>Admin Console — manual delay entry</h2>
        <p>Pick a train, the station it last reported from, and type its current delay. The model instantly projects the delay, ETA and 95% prediction interval at every remaining stop, next to the static-schedule baseline. Optionally set custom conditions ahead to run what-ifs.</p>
      </div>
      <div class="journey">
        <div class="journey-controls">
          <div class="card">
            <label class="sub" style="display:block" for="adm-train">Train (${nos.length} in service)</label>
            <select id="adm-train" class="train-select" aria-label="Select train">${trainOpts}</select>

            <label class="sub" style="display:block" for="adm-station">Last reported at station</label>
            <select id="adm-station" class="train-select" aria-label="Reported station"></select>

            <label class="sub" style="display:block" for="adm-delay">Current delay (minutes)</label>
            <div class="delay-entry">
              <button id="adm-minus" aria-label="decrease delay">−</button>
              <input id="adm-delay" type="number" value="15" min="-15" max="600" step="1" aria-label="Current delay in minutes" inputmode="numeric">
              <button id="adm-plus" aria-label="increase delay">+</button>
            </div>
            <button id="adm-save" aria-label="Save delay to the shared live board" style="width:100%;margin-top:var(--s-2);padding:var(--s-3);background:var(--accent-soft);border:1px solid var(--accent);border-radius:var(--r-2);color:var(--accent-ink);font-weight:650;cursor:pointer;transition:box-shadow var(--dur) var(--ease)">Save delay to live board</button>
            <div id="adm-save-status" class="mono" style="font-size:var(--t-xs);color:var(--ink-faint);margin-top:var(--s-1);min-height:14px"></div>

            <details class="adv" id="adm-adv">
              <summary>Conditions ahead (optional what-if)</summary>
              <label class="adv-toggle"><input type="checkbox" id="adv-on"> Apply custom conditions below</label>
              <div id="adv-fields" class="adv-fields">
                <label for="adv-cong">Section congestion ahead <span id="adv-cong-val" class="mono">0.40</span></label>
                <input id="adv-cong" type="range" min="0" max="1" step="0.01" value="0.40">
                <label for="adv-prec">Preceding-train delay (min)</label>
                <input id="adv-prec" type="number" value="0" min="0" max="300" step="1">
                <label for="adv-sr">Speed restriction ahead (km)</label>
                <input id="adv-sr" type="number" value="0" min="0" max="200" step="1">
                <div class="adv-checks">
                  <label><input type="checkbox" id="adv-monsoon"> Monsoon</label>
                  <label><input type="checkbox" id="adv-night"> Night run</label>
                </div>
              </div>
            </details>

            <div class="legend" style="margin-top:var(--s-4)">
              <div><span style="color:var(--accent)">■</span> model ETA &nbsp; <span class="base">■</span> static baseline ETA</div>
              <div style="margin-top:var(--s-2);color:var(--ink-faint)">Severity: <span style="color:var(--sev-1)">●</span> &lt;10m <span style="color:var(--sev-2)">●</span> 10–30m <span style="color:var(--sev-3)">●</span> &gt;30m</div>
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <div id="adm-tiles" class="stat-row"></div>
          </div>
          <div class="card">
            <h3>Projected arrivals for the remaining route</h3>
            <div class="sub">Model prediction (accent) vs static-schedule baseline (muted), with the 95% prediction interval.</div>
            <div class="tbl-wrap">
              <table class="data">
                <thead><tr>
                  <th class="name">Station</th><th>km</th><th>Sched</th><th>Pred. delay</th>
                  <th>Model ETA</th><th>95% interval</th><th>Static ETA</th>
                </tr></thead>
                <tbody id="adm-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>`;

    // wiring
    const trainSel = mount.querySelector('#adm-train');
    const stationSel = mount.querySelector('#adm-station');
    const delayInput = mount.querySelector('#adm-delay');
    const advCheck = mount.querySelector('#adv-on');

    trainSel.addEventListener('change', () => { trainNo = trainSel.value; refSeq = 2; syncStationAndAdvanced(); recompute(); });
    stationSel.addEventListener('change', () => { refSeq = +stationSel.value; // refresh expected defaults for the new segment
      const nSt = P.trainsIdx[trainNo].stations.length; const ex = expectedAhead(trainNo, refSeq, nSt);
      if (!advOn) { mount.querySelector('#adv-cong').value = ex.congestion.toFixed(2); mount.querySelector('#adv-cong-val').textContent = ex.congestion.toFixed(2); mount.querySelector('#adv-prec').value = Math.round(ex.preceding); }
      recompute(); });
    delayInput.addEventListener('input', () => { const v = parseFloat(delayInput.value); if (!isNaN(v)) { delay = v; recompute(); } });
    mount.querySelector('#adm-minus').addEventListener('click', () => { delay -= 1; delayInput.value = delay; recompute(); });
    mount.querySelector('#adm-plus').addEventListener('click', () => { delay += 1; delayInput.value = delay; recompute(); });

    // save the entered delay to the shared Supabase live board
    const saveBtn = mount.querySelector('#adm-save');
    const saveStatus = mount.querySelector('#adm-save-status');
    if (!(RC.db && RC.db.configured)) {
      saveBtn.disabled = true; saveBtn.style.opacity = '0.45'; saveBtn.style.cursor = 'not-allowed';
      saveStatus.textContent = 'offline mode — configure Supabase in js/config.js to share';
    } else {
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true; saveStatus.style.color = 'var(--ink-faint)'; saveStatus.textContent = 'saving…';
        try {
          await RC.db.saveLiveDelay(trainNo, refSeq, delay);
          const code = P.trainsIdx[trainNo].stations[refSeq - 1].code;
          saveStatus.style.color = 'var(--ok)';
          saveStatus.textContent = '✓ shared: ' + trainNo + ' ' + RC.fmt.fmtDelay(delay) + ' at ' + code;
        } catch (e) {
          saveStatus.style.color = 'var(--bad)';
          saveStatus.textContent = '✗ ' + String(e.message || e).slice(0, 60);
        } finally { saveBtn.disabled = false; }
      });
    }

    advCheck.addEventListener('change', () => { advOn = advCheck.checked; mount.querySelector('#adv-fields').classList.toggle('on', advOn); recompute(); });
    ['#adv-cong', '#adv-prec', '#adv-sr', '#adv-monsoon', '#adv-night'].forEach(sel => {
      mount.querySelector(sel).addEventListener('input', () => {
        if (sel === '#adv-cong') mount.querySelector('#adv-cong-val').textContent = parseFloat(mount.querySelector('#adv-cong').value).toFixed(2);
        if (advOn) recompute();
      });
    });

    syncStationAndAdvanced();
    recompute();
  }

  RC.ui = RC.ui || {};
  RC.ui.admin = { render };
})(this);
