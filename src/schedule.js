import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;

/**
 * Converte "HH:MM" + expressão de dias em uma linha OnCalendar do systemd.
 * days aceita: "Mon..Fri", "Mon,Wed,Fri", "Mon..Sun", "*", "" (todos os dias).
 *   toOnCalendar("07:00", "Mon..Fri") -> "Mon..Fri 07:00:00"
 *   toOnCalendar("23:30", "*")        -> "*-*-* 23:30:00"
 */
export function toOnCalendar(hhmm, days = '*') {
  const m = HHMM.exec(String(hhmm).trim());
  if (!m) throw new Error(`Horário inválido: "${hhmm}" (esperado "HH:MM").`);
  const time = `${m[1]}:${m[2]}:00`;

  const raw = String(days ?? '').trim();
  if (raw === '' || raw === '*') return `*-*-* ${time}`;

  // valida a lista de dias
  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  for (const tok of tokens) {
    const range = tok.split('..');
    if (range.length === 2) {
      if (!DAY.test(range[0]) || !DAY.test(range[1])) {
        throw new Error(`Dia inválido em "${tok}". Use Mon..Sun.`);
      }
    } else if (!DAY.test(tok)) {
      throw new Error(`Dia inválido: "${tok}". Use Mon,Tue,Wed,Thu,Fri,Sat,Sun ou intervalos "Mon..Fri".`);
    }
  }
  return `${tokens.join(',')} ${time}`;
}

/**
 * Valida uma expressão OnCalendar. Usa `systemd-analyze calendar` quando
 * disponível; senão faz uma checagem sintática básica.
 */
export async function validateOnCalendar(expr) {
  if (typeof expr !== 'string' || !expr.trim()) {
    return { ok: false, reason: 'expressão vazia' };
  }
  try {
    const { stdout } = await execFileAsync('systemd-analyze', ['calendar', expr], {
      timeout: 5000,
    });
    const next = /Next elapse:\s*(.+)/.exec(stdout)?.[1]?.trim();
    return { ok: true, next, checkedWith: 'systemd-analyze' };
  } catch (err) {
    if (err.code === 'ENOENT') {
      // systemd-analyze ausente (ex.: máquina de dev sem systemd no PATH)
      const looksOk = /[0-9*]/.test(expr);
      return { ok: looksOk, checkedWith: 'fallback', reason: looksOk ? undefined : 'formato improvável' };
    }
    const msg = (err.stderr || err.stdout || err.message || '').trim();
    return { ok: false, checkedWith: 'systemd-analyze', reason: msg };
  }
}
