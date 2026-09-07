import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { paths } from './paths.js';
import { resolveSlots } from './slots.js';
import { readCache, runRefresh } from './refresh.js';
import { createLogger } from './logger.js';

/**
 * Cria (sem escutar) a instância Fastify da dashboard.
 * @param {object} config
 */
export async function buildServer(config, { logger = createLogger('server') } = {}) {
  const app = Fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: paths.publicDir,
    prefix: '/',
    index: false,
  });

  const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(indexHtml);
  });

  // Estado completo para o cliente montar o grid.
  app.get('/api/state', async () => {
    const slots = (await resolveSlots(config)).filter((s) => s.enabled);
    const out = [];
    for (const slot of slots) {
      out.push({
        id: slot.id,
        title: slot.title,
        span: slot.span,
        hasView: Boolean(slot.viewFile),
        hasCss: Boolean(slot.cssFile),
        settings: slot.settings,
        cache: await readCache(slot.id),
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      timezone: config.timezone,
      layout: config.layout,
      slots: out,
    };
  });

  // Assets client-side de cada slot.
  app.get('/slots/:id/view.js', async (req, reply) => {
    await sendSlotAsset(config, req.params.id, 'viewFile', 'application/javascript', reply);
  });
  app.get('/slots/:id/view.css', async (req, reply) => {
    await sendSlotAsset(config, req.params.id, 'cssFile', 'text/css', reply);
  });

  // Refresh sob demanda (usado pela UI e por testes).
  app.post('/api/refresh', async (req) => {
    const only = typeof req.query?.slot === 'string' ? [req.query.slot] : undefined;
    const { results } = await runRefresh(config, { only, logger: logger.child('refresh') });
    return { results };
  });

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));

  return app;
}

async function sendSlotAsset(config, id, key, mime, reply) {
  const slots = await resolveSlots(config);
  const slot = slots.find((s) => s.id === id && s.enabled);
  if (!slot || !slot[key]) {
    reply.code(404).send({ error: 'not found' });
    return;
  }
  const body = await readFile(slot[key], 'utf8');
  reply.type(mime).header('cache-control', 'no-cache').send(body);
}

/** Sobe o servidor e devolve { app, url }. */
export async function startServer(config, opts = {}) {
  const app = await buildServer(config, opts);
  const { host, port } = config.server;
  await app.listen({ host, port });
  return { app, url: `http://${host}:${port}` };
}
