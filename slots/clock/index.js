/**
 * Slot "clock" — prova o ciclo refresh -> cache -> render.
 *
 * O refresh apenas registra o instante em que rodou e o fuso configurado;
 * a contagem viva dos segundos acontece no cliente (view.js).
 */
export async function refresh(ctx) {
  const now = ctx.now ?? new Date();
  return {
    isoTime: now.toISOString(),
    timezone: ctx.config?.timezone ?? 'UTC',
    // texto opcional configurável em slots[].settings.label
    label: ctx.settings?.label ?? null,
  };
}
