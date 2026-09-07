/**
 * render(el, data, ctx)
 *   el   -> elemento container do slot (div.slot-body)
 *   data -> conteúdo de data/cache/clock.json .data
 *   ctx  -> { slot, settings, timezone, updatedAt }
 *
 * Devolve (opcional) uma função de limpeza, chamada antes do próximo render.
 */
export function render(el, data, ctx) {
  const tz = data?.timezone || ctx.timezone || undefined;
  const label = data?.label || ctx.settings?.label || '';

  el.innerHTML = `
    <div class="clock">
      <div class="clock-time" data-role="time">--:--:--</div>
      <div class="clock-date" data-role="date">—</div>
      ${label ? `<div class="clock-label">${escapeHtml(label)}</div>` : ''}
    </div>`;

  const timeEl = el.querySelector('[data-role=time]');
  const dateEl = el.querySelector('[data-role=date]');

  const tick = () => {
    const now = new Date();
    timeEl.textContent = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: tz,
    }).format(now);
    const dateStr = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: tz,
    }).format(now);
    dateEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  };

  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
