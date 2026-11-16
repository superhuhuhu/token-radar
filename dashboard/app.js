// Token Radar dashboard: a static page over window.RADAR, no network, no fetch.
// Board (sortable, filterable), a detail view per protocol, the live-token set
// apart, and the model that built every implied value, stated in full.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtUsd = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const fmtPct = (n) => {
  if (n === null || n === undefined) return '—';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return `<span class="${cls}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
};
const fmtAge = (d) => {
  if (d === null || d === undefined) return '—';
  if (d >= 365) return `${(d / 365).toFixed(1)}y`;
  return `${d}d`;
};
const params = new URLSearchParams(location.search);
const state = {
  view: params.get('view') || 'board',
  slug: params.get('slug') || '',
  q: params.get('q') || '',
  cat: params.get('cat') || '',
  minTvl: Number(params.get('minTvl') || 0),
  watch: params.get('watch') === '1',
  sort: params.get('sort') || 'value',
  page: Math.max(1, Number(params.get('page') || 1)),
};
const PAGE_SIZE = 50;

/** The rows after the board's filters, in the chosen sort. */
function filteredRows() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    if (state.watch && !r.watchlist) return false;
    return true;
  });
  const key = {
    value: (a, b) => a.implied_value_usd - b.implied_value_usd,
    tvl: (a, b) => a.tvl_usd - b.tvl_usd,
    growth: (a, b) => (a.change_7d ?? 0) - (b.change_7d ?? 0),
    age: (a, b) => (a.age_days ?? -1) - (b.age_days ?? -1),
  }[state.sort] || ((a, b) => a.implied_value_usd - b.implied_value_usd);
  rows = rows.slice().sort((a, b) => key(b, a) || a.rank - b.rank);
  return rows;
}

function showView(name) {
  state.view = name;
  for (const v of ['board', 'detail', 'live', 'model']) {
    const el = $('view-' + v);
    if (el) el.hidden = v !== name;
  }
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('on', b.dataset.view === name || (name === 'detail' && b.dataset.view === 'board'));
  }
}

function renderStats() {
  const top = R.rows[0];
  $('stats').innerHTML =
    stat(R.board_size, 'pre-token protocols ranked') +
    stat(R.watchlist_size, 'on the watchlist') +
    stat(fmtUsd(top ? top.implied_value_usd : 0), 'top implied value') +
    stat(R.live_size, 'live tokens set aside') +
    stat(R.as_of, 'snapshot date');
  function stat(b, label) {
    return `<div class="stat"><b>${esc(b)}</b><span>${esc(label)}</span></div>`;
  }
}

function renderBoard() {
  const rows = filteredRows();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * PAGE_SIZE;
  const page = rows.slice(start, start + PAGE_SIZE);
  $('count').textContent =
    `${rows.length} of ${R.board_size} protocols` +
    (state.cat ? ` · category ${state.cat}` : '') +
    (state.watch ? ' · watchlist only' : '') +
    (state.minTvl ? ` · TVL ${fmtUsd(state.minTvl)}+` : '') +
    (state.q ? ` · matching “${state.q}”` : '');
  $('rows').innerHTML = page
    .map(
      (r) => `<tr data-slug="${esc(r.slug)}">
        <td>${r.rank}</td>
        <td><span class="name">${esc(r.name)}</span><span class="slug">${esc(r.slug)}</span>${r.watchlist ? '<span class="tag">watchlist</span>' : ''}</td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${esc(r.chains.slice(0, 3).join(', ') || '—')}</td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num">${fmtPct(r.change_7d)}</td>
        <td class="num">${fmtAge(r.age_days)}</td>
        <td class="num val">${fmtUsd(r.implied_value_usd)}</td>
      </tr>`,
    )
    .join('');
  $('pager').innerHTML =
    `<button type="button" id="prevPg" ${state.page <= 1 ? 'disabled' : ''}>← Previous</button>` +
    `<span>Page ${state.page} of ${pages}</span>` +
    `<button type="button" id="nextPg" ${state.page >= pages ? 'disabled' : ''}>Next →</button>`;
  const prev = $('prevPg');
  const next = $('nextPg');
  if (prev) prev.onclick = () => { state.page -= 1; syncUrl(); renderBoard(); };
  if (next) next.onclick = () => { state.page += 1; syncUrl(); renderBoard(); };
}

function renderDetail() {
  const row = R.rows.find((r) => r.slug === state.slug);
  if (!row) {
    $('detail').innerHTML = '<div class="card"><h2>Protocol not found</h2><p class="meta">No board row has that slug.</p></div>';
    return;
  }
  const comps = R.comparables[row.category || ''] || [];
  const base = row.tvl_usd * row.multiple;
  const chainList = row.chains.length > 5 ? `${row.chains.slice(0, 5).join(', ')} +${row.chains.length - 5} more` : row.chains.join(', ');
  $('detail').innerHTML = `<div class="card">
    <h2>${esc(row.name)}${row.watchlist ? '<span class="tag">watchlist</span>' : ''}</h2>
    <p class="meta">${esc(row.category ?? 'Uncategorised')} · ${esc(chainList || 'no chain listed')} · tracked since ${esc(row.listed_at ?? 'unknown')} · records no token</p>
    <div class="kv">
      <div><b>${fmtUsd(row.implied_value_usd)}</b><span>Implied value</span></div>
      <div><b>${fmtUsd(row.tvl_usd)}</b><span>TVL</span></div>
      <div><b>${row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%'}</b><span>7-day change</span></div>
      <div><b>${fmtAge(row.age_days)}</b><span>Age</span></div>
      <div><b>rank ${row.rank} of ${R.board_size}</b><span>Board rank</span></div>
    </div>
    <h3>How the value is built</h3>
    <p class="formula">implied = TVL × ${row.multiple} × ${row.growth_multiplier} × ${row.age_factor} × ${row.chain_factor}
      = ${fmtUsd(row.tvl_usd)} × ${row.multiple} × ${row.growth_multiplier} × ${row.age_factor} × ${row.chain_factor}
      = ${fmtUsd(row.implied_value_usd)}</p>
    <p>${esc(row.multiple_source)}: the market pays ${row.multiple}× TVL for a live ${esc(row.category ?? 'protocol')} token. ` +
    `Growth ${row.change_7d === null ? 'unreported' : row.change_7d.toFixed(1) + '% over 7 days'} sets the growth multiplier to ${row.growth_multiplier}; ` +
    `${row.age_days === null ? 'an unknown listing date' : fmtAge(row.age_days) + ' of history'} sets the age factor to ${row.age_factor}; ` +
    `${row.chains.length} chain${row.chains.length === 1 ? '' : 's'} set the chain factor to ${row.chain_factor}.</p>
    ${comps.length ? `<h3>Where the multiple comes from</h3><ul class="comps">${comps.map((c) => `<li><b>${esc(c.name)}</b> — market cap ${fmtUsd(c.mcap_usd)} on TVL ${fmtUsd(c.tvl_usd)}, ${c.ratio}×</li>`).join('')}</ul>` : ''}
    <h3>Farm plan — what to do about ${esc(row.name)}</h3>
    <ol class="steps">${row.farm_steps.map((s) => { const i = s.indexOf(' Cost: '); return `<li><p>${esc(i >= 0 ? s.slice(0, i) : s)}</p><p class="cost">${esc(i >= 0 ? s.slice(i + 1) : '')}</p></li>`; }).join('')}</ol>
  </div>`;
}

function renderLive() {
  $('liveRows').innerHTML = R.live
    .map(
      (r) => `<tr>
        <td><span class="name">${esc(r.name)}</span><span class="slug">${esc(r.slug)}</span></td>
        <td>${esc(r.category ?? '—')}</td>
        <td>${esc(r.chains.slice(0, 3).join(', ') || '—')}</td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num">${fmtUsd(r.mcap_usd)}</td>
        <td class="num">${r.mcap_tvl === null ? '—' : r.mcap_tvl + '×'}</td>
      </tr>`,
    )
    .join('');
}

function renderModel() {
  $('modelCard').innerHTML = `<h2>How the value is built</h2>
    <p>Every implied value is the market's own pricing, read off this snapshot's live protocols and applied to a pre-token protocol's TVL. No name is ever special-cased.</p>
    <p class="formula">implied = TVL × multiple(category) × growth × age × chains</p>
    <p><code>multiple(category)</code> is the median market-cap-to-TVL ratio of the live protocols in that category (at least three of them, else the global median of ${R.global_multiple}), clamped to 0.05–1.50.</p>
    <p><code>growth</code> is 1 + 0.5 × the 7-day TVL change, clamped to −50%…+100%, so a week's growth moves the value by at most half its size.</p>
    <p><code>age</code> runs from 0.70 for a protocol listed yesterday to 1.00 after four years of running with no token; an unknown listing date scores 0.85.</p>
    <p><code>chains</code> adds 0.02 per chain, up to five chains: wider distribution is worth a little more.</p>
    <p>Model ${esc(R.model_version)}. The board ranks ${R.board_size} pre-token protocols: the ${R.watchlist_size} on the watchlist plus every other rankable one the snapshot carries.</p>`;
  $('multRows').innerHTML = R.multiples
    .map((m) => `<tr><td>${esc(m.category)}</td><td class="num">${m.sample}</td><td class="num">${m.multiple}×</td></tr>`)
    .join('');
}

function syncUrl() {
  try {
    const p = new URLSearchParams();
    if (state.view !== 'board' || state.slug) { p.set('view', state.view); if (state.slug) p.set('slug', state.slug); }
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.minTvl) p.set('minTvl', String(state.minTvl));
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'value') p.set('sort', state.sort);
    if (state.page > 1) p.set('page', String(state.page));
    const qs = p.toString();
    history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
  } catch (e) { /* file URLs may refuse replaceState; the page works without it */ }
}

function openDetail(slug) {
  state.slug = slug;
  state.page = 1;
  showView('detail');
  renderDetail();
  syncUrl();
  window.scrollTo(0, 0);
}

function init() {
  renderStats();
  const cats = [...new Set(R.rows.map((r) => r.category).filter((c) => c !== null))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('minTvl').value = String(state.minTvl);
  $('watchOnly').checked = state.watch;
  $('sort').value = state.sort;
  $('q').addEventListener('input', (e) => { state.q = e.target.value; state.page = 1; renderBoard(); });
  $('q').addEventListener('change', syncUrl);
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; state.page = 1; syncUrl(); renderBoard(); });
  $('minTvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); state.page = 1; syncUrl(); renderBoard(); });
  $('watchOnly').addEventListener('change', (e) => { state.watch = e.target.checked; state.page = 1; syncUrl(); renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; syncUrl(); renderBoard(); });
  document.querySelectorAll('#board thead th[data-k]').forEach((th) => {
    th.addEventListener('click', () => {
      state.sort = th.dataset.k === 'rank' ? 'value' : th.dataset.k;
      $('sort').value = state.sort;
      state.page = 1;
      syncUrl();
      renderBoard();
    });
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  $('backBtn').addEventListener('click', () => { state.slug = ''; showView('board'); syncUrl(); renderBoard(); });
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      state.slug = '';
      showView(b.dataset.view);
      if (b.dataset.view === 'live') renderLive();
      if (b.dataset.view === 'model') renderModel();
      syncUrl();
      window.scrollTo(0, 0);
    });
  });
  $('footNote').textContent = `Snapshot: DefiLlama protocols, fetched ${R.as_of}. Watchlist floor $${R.floor_usd.toLocaleString('en-US')}. ${R.board_size} pre-token protocols ranked; ${R.live_size} live tokens shown apart.`;
  renderBoard();
  if (state.view === 'detail') { showView('detail'); renderDetail(); }
  else if (state.view === 'live') { showView('live'); renderLive(); }
  else if (state.view === 'model') { showView('model'); renderModel(); }
  else showView('board');
}

init();
