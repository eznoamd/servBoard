export function render(el, data) {
  const parts = [];
  if (data?.text) {
    parts.push(`<p class="notes-text">${escapeHtml(data.text).replace(/\n/g, '<br>')}</p>`);
  }
  if (Array.isArray(data?.items) && data.items.length) {
    parts.push(
      '<ul class="notes-list">' +
        data.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('') +
        '</ul>',
    );
  }
  el.innerHTML = `<div class="notes">${parts.join('') || '<p class="notes-text">—</p>'}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
