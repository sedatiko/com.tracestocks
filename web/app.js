(() => {
  'use strict';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const fmtExpiration = (exp) => {
    if (!exp || exp.length !== 8) return exp ?? '';
    const m = MONTHS[parseInt(exp.slice(4, 6), 10) - 1] ?? exp.slice(4, 6);
    return `${exp.slice(6, 8)} ${m} ${exp.slice(0, 4)}`;
  };

  const fmtNum = (v, digits = 2) =>
    v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(digits);

  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const state = {
    results:      [],
    filters:      { symbol: '', right: '', minDte: '', maxDte: '', minPct: '', maxPct: '', scannedAt: '' },
    sort:         { key: 'premiumPct', dir: 'desc' },
    chart:        null,
    activeScan:   '',
  };

  // ----- API -----
  const api = async (path, params = {}) => {
    const url = new URL(path, window.location.origin);
    for (const [k, v] of Object.entries(params)) {
      if (v !== '' && v != null) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API ${path} ${res.status}`);
    return res.json();
  };

  // ----- Cards -----
  const renderCards = (symbols) => {
    const root = document.getElementById('cards');
    if (!symbols.length) {
      root.innerHTML = `<div class="card"><div class="muted">No scans yet — run <code>npm run optscan</code></div></div>`;
      return;
    }
    root.innerHTML = symbols.map((s) => `
      <div class="card">
        <div class="sym">${s.symbol}</div>
        <div class="row"><span class="k">Underlying</span><span class="v">${s.lastUnderlying != null ? '$' + fmtNum(s.lastUnderlying) : '—'}</span></div>
        <div class="row call"><span class="k">Best Call %</span><span class="v">${s.bestCallPct != null ? fmtNum(s.bestCallPct) + '%' : '—'}</span></div>
        <div class="row put"><span class="k">Best Put %</span><span class="v">${s.bestPutPct != null ? fmtNum(s.bestPutPct) + '%' : '—'}</span></div>
        <div class="row"><span class="k">Scans</span><span class="v">${s.scanCount}</span></div>
        <div class="row"><span class="k">Last</span><span class="v small">${fmtTime(s.lastScanned)}</span></div>
      </div>
    `).join('');

    // Populate symbol filter
    const sel = document.getElementById('f-symbol');
    const current = sel.value;
    sel.innerHTML = '<option value="">All</option>' + symbols.map((s) => `<option value="${s.symbol}">${s.symbol}</option>`).join('');
    sel.value = current;
  };

  // ----- Scans timeline -----
  const renderScans = (scans) => {
    const root = document.getElementById('scans');
    if (!scans.length) {
      root.innerHTML = `<li class="muted">No scans yet</li>`;
      return;
    }
    root.innerHTML = scans.map((s) => `
      <li data-scanned-at="${s.scannedAt}" class="${state.activeScan === s.scannedAt ? 'active' : ''}">
        <time>${fmtTime(s.scannedAt)}</time>
        <span class="muted">${s.total} hits · ${s.symbols} sym</span>
        <span class="pill">max ${fmtNum(s.maxPremiumPct)}%</span>
      </li>
    `).join('');

    // Populate scan select
    const sel = document.getElementById('f-scan');
    const current = sel.value;
    sel.innerHTML = '<option value="">All scans</option>' + scans.map((s) => `<option value="${s.scannedAt}">${fmtTime(s.scannedAt)}</option>`).join('');
    sel.value = current;

    root.querySelectorAll('li[data-scanned-at]').forEach((li) => {
      li.addEventListener('click', () => {
        const at = li.dataset.scannedAt ?? '';
        state.activeScan = state.activeScan === at ? '' : at;
        document.getElementById('f-scan').value = state.activeScan;
        state.filters.scannedAt = state.activeScan;
        renderScans(scans);
        loadResults();
      });
    });
  };

  // ----- Distribution chart -----
  const renderDistribution = (buckets, bucketSize) => {
    const ctx = document.getElementById('dist-chart');
    const labels = buckets.map((b) => `${Number(b.bucket).toFixed(1)}–${(Number(b.bucket) + bucketSize).toFixed(1)}%`);
    const data   = buckets.map((b) => b.count);

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = data;
      state.chart.update();
      return;
    }
    state.chart = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Hits',
          data,
          backgroundColor: '#4f8cff',
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#8a96a8', maxRotation: 45 }, grid: { color: '#2a3140' } },
          y: { ticks: { color: '#8a96a8' }, grid: { color: '#2a3140' }, beginAtZero: true },
        },
      },
    });
  };

  // ----- Results table -----
  const sortResults = (rows) => {
    const { key, dir } = state.sort;
    const mult = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
      return String(va).localeCompare(String(vb)) * mult;
    });
  };

  const renderTable = () => {
    const tbody = document.getElementById('results-body');
    const rows = sortResults(state.results);
    document.getElementById('result-count').textContent = `${rows.length} contract${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="13" class="empty">No matches</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${r.symbol}</strong></td>
        <td><span class="tag ${r.right === 'C' ? 'call' : 'put'}">${r.right === 'C' ? 'CALL' : 'PUT'}</span></td>
        <td class="num">$${fmtNum(r.strike)}</td>
        <td>${fmtExpiration(r.expiration)}</td>
        <td class="num">${r.dte ?? '—'}</td>
        <td class="num">$${fmtNum(r.premium)}</td>
        <td class="num"><strong>${fmtNum(r.premiumPct)}%</strong></td>
        <td class="num">${r.iv    != null ? fmtNum(r.iv * 100, 1) + '%' : '—'}</td>
        <td class="num">${r.delta != null ? fmtNum(r.delta, 3) : '—'}</td>
        <td class="num">${r.theta != null ? fmtNum(r.theta, 3) : '—'}</td>
        <td class="num">${r.volume ?? '—'}</td>
        <td class="num">${r.underlyingPrice != null ? '$' + fmtNum(r.underlyingPrice) : '—'}</td>
        <td class="small muted">${fmtTime(r.scannedAt)}</td>
      </tr>
    `).join('');

    // Update sort indicators
    document.querySelectorAll('thead th').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.key === state.sort.key) {
        th.classList.add(state.sort.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });
  };

  // ----- Loaders -----
  const loadResults = async () => {
    const f = state.filters;
    const data = await api('/api/results', {
      symbol:        f.symbol,
      right:         f.right,
      minDte:        f.minDte,
      maxDte:        f.maxDte,
      minPremiumPct: f.minPct,
      maxPremiumPct: f.maxPct,
      scannedAt:     f.scannedAt,
      limit:         1000,
    });
    state.results = data.results || [];
    renderTable();
  };

  const loadAll = async () => {
    document.getElementById('last-updated').textContent = 'Loading…';
    try {
      const [symbols, scans, dist] = await Promise.all([
        api('/api/symbols'),
        api('/api/scans', { limit: 50 }),
        api('/api/distribution', { bucketSize: 0.5 }),
      ]);
      renderCards(symbols.symbols || []);
      renderScans(scans.scans || []);
      renderDistribution(dist.distribution || [], dist.bucketSize || 0.5);
      await loadResults();
      document.getElementById('last-updated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      console.error(err);
      document.getElementById('last-updated').textContent = `Error: ${err.message}`;
    }
  };

  // ----- Bindings -----
  const readFilters = () => {
    state.filters.symbol    = document.getElementById('f-symbol').value;
    state.filters.right     = document.getElementById('f-right').value;
    state.filters.minDte    = document.getElementById('f-min-dte').value;
    state.filters.maxDte    = document.getElementById('f-max-dte').value;
    state.filters.minPct    = document.getElementById('f-min-pct').value;
    state.filters.maxPct    = document.getElementById('f-max-pct').value;
    state.filters.scannedAt = document.getElementById('f-scan').value;
    state.activeScan        = state.filters.scannedAt;
  };

  document.getElementById('f-apply').addEventListener('click', () => {
    readFilters();
    loadResults();
  });
  document.getElementById('f-clear').addEventListener('click', () => {
    ['f-symbol','f-right','f-min-dte','f-max-dte','f-min-pct','f-max-pct','f-scan']
      .forEach((id) => { document.getElementById(id).value = ''; });
    readFilters();
    loadResults();
  });
  document.getElementById('refresh').addEventListener('click', loadAll);

  document.querySelectorAll('thead th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (!key) return;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = key;
        state.sort.dir = 'desc';
      }
      renderTable();
    });
  });

  loadAll();
})();
