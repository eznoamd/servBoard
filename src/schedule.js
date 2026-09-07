import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;
const DAYNUM = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * Converte uma expressão de dias do systemd num Set de números ISO (Mon=1..Sun=7).
 *   parseDays("Mon..Fri")     -> {1,2,3,4,5}
 *   parseDays("Sat,Sun")      -> {6,7}
 *   parseDays("Fri..Mon")     -> {5,6,7,1}   (com volta na semana)
 *   parseDays("*") / ""       -> {1..7}
 */
export function parseDays(expr) {
  const raw = String(expr ?? '').trim();
  if (raw === '' || raw === '*') return new Set([1, 2, 3, 4, 5, 6, 7]);
  const out = new Set();
  for (const tok of raw.split(',').map((t) => t.trim()).filter(Boolean)) {
    const range = tok.split('..');
    if (range.length === 2) {
      const a = DAYNUM[range[0]];
      const b = DAYNUM[range[1]];
      if (!a || !b) throw new Error(`Dia inválido em "${tok}". Use Mon..Sun.`);
      let i = a;
      for (let guard = 0; guard < 8; guard++) {
        out.add(i);
        if (i === b) break;
        i = i === 7 ? 1 : i + 1;
      }
    } else {
      const d = DAYNUM[tok];
      if (!d) throw new Error(`Dia inválido: "${tok}". Use Mon..Sun ou intervalos "Mon..Fri".`);
      out.add(d);
    }
  }
  return out;
}

/** minutos desde 00:00 de um "HH:MM". */
function minutesOf(hhmm) {
  const m = HHMM.exec(String(hhmm).trim());
  if (!m) throw new Error(`Horário inválido: "${hhmm}" (esperado "HH:MM").`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Hora/minuto/dia-da-semana de `date` num fuso específico. */
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: DAYNUM[get('weekday')] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * `date` está dentro da janela de exibição configurada?
 * Suporta janelas que viram a meia-noite (start > stop).
 * @param {Date} date
 * @param {{start:string, stop:string, days?:string, timezone?:string}} window
 */
export function isWithinWindow(date, { start, stop, days = '*', timezone } = {}) {
  const startMin = minutesOf(start);
  const stopMin = minutesOf(stop);
  const dayset = parseDays(days);
  const { weekday, minutes } = localParts(date, timezone);

  if (startMin === stopMin) return false; // janela de duração zero

  if (startMin < stopMin) {
    return dayset.has(weekday) && minutes >= startMin && minutes < stopMin;
  }
  // janela noturna: 22:00 -> 06:00. O dia contado é o do início.
  if (minutes >= startMin) return dayset.has(weekday);
  if (minutes < stopMin) {
    const yesterday = weekday === 1 ? 7 : weekday - 1;
    return dayset.has(yesterday);
  }
  return false;
}

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
