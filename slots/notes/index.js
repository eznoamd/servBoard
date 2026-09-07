/**
 * Slot "notes" — prova a configuração por-slot vinda de config/servboard.json.
 *
 * Configure em slots[].settings:
 *   { "text": "linha 1\nlinha 2", "items": ["a", "b"] }
 */
export async function refresh(ctx) {
  const s = ctx.settings ?? {};
  const items = Array.isArray(s.items) ? s.items.map(String) : [];
  const text = typeof s.text === 'string' ? s.text : '';

  if (!text && items.length === 0) {
    return { text: 'Configure este slot em config/servboard.json → slots[].settings.text', items: [] };
  }
  return { text, items };
}
