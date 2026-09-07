/**
 * Cliente da dashboard: busca /api/state, monta o grid de slots, carrega o
 * view.js de cada slot e faz polling para refletir novo cache sem recarregar.
 */

const grid = document.getElementById('grid');
const statusInfo = document.getElementById('status-info');
const statusClock = document.getElementById('status-clock');
const statusBar = document.getElementById('status');
const refreshBtn = document.getElementById('refresh-btn');

const STATE_POLL_MS = 15_000;
const STALE_AFTER_MS = 5 * 60_000;

// por slot: { el, bodyEl, cleanup, renderFn, lastKey }
const mounted = new Map();
const viewCache = new Map(); // id -> Promise<module|null>

if (window.matchMedia('(display-mode: fullscreen)').matches || navigator.userAgent.includes('kiosk')) {
  document.body.classList.add('kiosk');
}

function loadView(slot) {
  if (!slot.hasView) return Promise.resolve(null);
  if (!viewCache.has(slot.id)) {
    viewCache.set(
      slot.id,
      import(`/slots/${slot.id}/view.js`).catch((err) => {
        console.error(`view.js de "${slot.id}" falhou:`, err);
        return null;
      }),
    );
  }
  return viewCache.get(slot.id);
}

function ensureCss(slot) {
  if (!slot.hasCss) return;
  const id = `css-${slot.id}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `/slots/${slot.id}/view.css`;
  document.head.appendChild(link);
}

function slotShell(slot) {
  const el = document.createElement('section');
  el.className = 'slot';
  el.style.setProperty('--span', slot.span || 1);
  el.dataset.slot = slot.id;
  el.innerHTML = `
    <div class="slot-head">
      <span>${escapeHtml(slot.title || slot.id)}</span>
      <span class="dot" data-role="dot"></span>
    </div>
    <div class="slot-body" data-role="body"></div>`;
  return el;
}

async function renderSlot(slot) {
  let entry = mounted.get(slot.id);
  if (!entry) {
    const el = slotShell(slot);
    grid.appendChild(el);
    entry = { el, bodyEl: el.querySelector('[data-role=body]'), cleanup: null, lastKey: null };
    mounted.set(slot.id, entry);
    ensureCss(slot);
  }
  entry.el.style.setProperty('--span', slot.span || 1);
  entry.el.querySelector('.slot-head span').textContent = slot.title || slot.id;

  const cache = slot.cache;
  const dot = entry.el.querySelector('[data-role=dot]');
  const updatedAt = cache?.updatedAt ? new Date(cache.updatedAt).getTime() : 0;
  const stale = updatedAt && Date.now() - updatedAt > STALE_AFTER_MS;
  dot.className = 'dot' + (cache?.error ? ' error' : stale ? ' stale' : '');
  dot.title = cache?.error
    ? `erro: ${cache.error}`
    : cache?.updatedAt
      ? `atualizado ${new Date(cache.updatedAt).toLocaleString('pt-BR')}`
      : 'sem dados ainda';

  // evita re-render desnecessário
  const key = JSON.stringify([cache?.updatedAt, cache?.error, cache?.data, slot.settings]);
  if (key === entry.lastKey) return;
  entry.lastKey = key;

  if (typeof entry.cleanup === 'function') {
    try { entry.cleanup(); } catch { /* ignore */ }
    entry.cleanup = null;
  }

  if (cache?.error && cache.data == null) {
    entry.bodyEl.innerHTML = `<div class="slot-error">${escapeHtml(cache.error)}</div>`;
    return;
  }

  const data = cache?.data ?? null;
  const mod = await loadView(slot);
  const ctx = {
    slot: slot.id,
    settings: slot.settings || {},
    timezone: currentTimezone,
    updatedAt: cache?.updatedAt || null,
  };

  if (mod && typeof mod.render === 'function') {
    try {
      const cleanup = mod.render(entry.bodyEl, data, ctx);
      if (typeof cleanup === 'function') entry.cleanup = cleanup;
    } catch (err) {
      entry.bodyEl.innerHTML = `<div class="slot-error">render falhou: ${escapeHtml(err.message)}</div>`;
    }
  } else {
    entry.bodyEl.innerHTML = `<pre class="slot-raw">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }
}

let currentTimezone;

async function tickState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    currentTimezone = state.timezone;

    document.documentElement.style.setProperty('--columns', state.layout?.columns ?? 3);
    document.documentElement.style.setProperty('--gap', `${state.layout?.gap ?? 16}px`);

    const boot = grid.querySelector('.boot');
    if (boot) boot.remove();

    const wantIds = new Set(state.slots.map((s) => s.id));
    for (const [id, entry] of mounted) {
      if (!wantIds.has(id)) {
        if (typeof entry.cleanup === 'function') try { entry.cleanup(); } catch { /* */ }
        entry.el.remove();
        mounted.delete(id);
      }
    }
    // ordem
    for (const slot of state.slots) await renderSlot(slot);
    for (const slot of state.slots) grid.appendChild(mounted.get(slot.id).el);

    const errs = state.slots.filter((s) => s.cache?.error).length;
    statusBar.classList.toggle('err', errs > 0);
    statusInfo.textContent =
      `${state.slots.length} slot(s)` + (errs ? ` · ${errs} com erro` : ' · ok') +
      ` · ${new Date(state.generatedAt).toLocaleTimeString('pt-BR')}`;
  } catch (err) {
    statusBar.classList.add('err');
    statusInfo.textContent = `sem conexão com o servidor (${err.message})`;
  }
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  statusInfo.textContent = 'atualizando…';
  try {
    await fetch('/api/refresh', { method: 'POST' });
    await tickState();
  } finally {
    refreshBtn.disabled = false;
  }
});

setInterval(() => {
  statusClock.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}, 1000);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

tickState();
setInterval(tickState, STATE_POLL_MS);
