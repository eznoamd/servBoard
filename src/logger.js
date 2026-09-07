// Logger minimalista, sem dependências. Formato: HH:MM:SS nível escopo mensagem
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (process.env.SERVBOARD_LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[envLevel] ?? LEVELS.info;

function ts() {
  return new Date().toTimeString().slice(0, 8);
}

function emit(level, scope, args) {
  if (LEVELS[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  const tag = scope ? `[${scope}]` : '';
  stream.write(`${ts()} ${level.toUpperCase().padEnd(5)} ${tag} ${args.join(' ')}\n`);
}

export function createLogger(scope = '') {
  return {
    debug: (...a) => emit('debug', scope, a),
    info: (...a) => emit('info', scope, a),
    warn: (...a) => emit('warn', scope, a),
    error: (...a) => emit('error', scope, a),
    child: (sub) => createLogger(scope ? `${scope}:${sub}` : sub),
  };
}

export const logger = createLogger('servboard');
