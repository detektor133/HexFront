// Stop-хук: пока в рабочем дереве есть изменения, ход нельзя закончить с красной проверкой.
// Код 2 + stderr — Codex продолжает работу с этим текстом. Код 0 — ход завершается.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Читает JSON события из stdin; при пустом или битом вводе — пустой объект. */
function readEvent() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() === '' ? {} : JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`stop-verify: не удалось разобрать вход хука: ${String(err)}\n`);
    return {};
  }
}

const event = readEvent();

// Ход уже был продолжен этим хуком — не зацикливаемся, решение за агентом.
if (event.stop_hook_active === true) process.exit(0);

let dirty = '';
try {
  dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
} catch (err) {
  process.stderr.write(`stop-verify: git status упал, проверка пропущена: ${String(err)}\n`);
  process.exit(0);
}
if (dirty === '') process.exit(0);

const run = spawnSync('pnpm', ['verify', '--changed'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 16 * 1024 * 1024,
});

if (run.status === 0) process.exit(0);

// verify сам печатает итог до 20 строк; берём хвост на случай аварийного вывода.
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n');
process.stderr.write(`pnpm verify --changed не прошёл. Исправь и закончи снова.\n${out}\n`);
process.exit(2);
