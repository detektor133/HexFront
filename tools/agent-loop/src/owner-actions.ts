// Ответы владельца на ожидание клавишей консоли: что можно сделать с этим ожиданием (повторить,
// открыть ссылку или готовую Issue, перезапустить прогон на GitHub) и как открыть ссылку в ОС.
import { spawn } from 'node:child_process';

import { TASK_ID_SOURCE } from './stage-file.ts';

/**
 * Клавиша действия — русская буква; латиница той же физической клавиши тоже работает, чтобы
 * владельцу не переключать раскладку. Цифры, плюс и минус заняты числом агентов.
 */
export const ACTION_KEYS = { П: 'g', О: 'j', И: 'b', Д: 'l', З: 'p', Л: 'k' } as const;
export type ActionKey = keyof typeof ACTION_KEYS;

export type WaitAction =
  /** Повторить шаг, на котором цикл ждёт: то же, что перезапуск цикла, но без выхода. */
  | { readonly kind: 'retry'; readonly key: 'П'; readonly label: string }
  /** Открыть ссылку или файл в программе по умолчанию. */
  | {
      readonly kind: 'open';
      readonly key: 'О' | 'И' | 'Д' | 'Л';
      readonly label: string;
      readonly target: string;
    }
  /** Перезапустить упавшие jobs прогона GitHub Actions. */
  | {
      readonly kind: 'rerun';
      readonly key: 'З';
      readonly label: string;
      readonly runId: number;
    };

/** Клавиша действия по введённому символу в любой раскладке; иначе undefined. */
export function actionKey(key: string): ActionKey | undefined {
  const lower = key.toLowerCase();
  for (const [russian, latin] of Object.entries(ACTION_KEYS) as [ActionKey, string][])
    if (lower === russian.toLowerCase() || lower === latin) return russian;
  return undefined;
}

/**
 * Ожидания, которые повтор шага не снимет: нужна Issue владельца (задача владельца, очередь,
 * разбиение) или мерж PR этапа — его цикл и так проверяет на каждом шаге.
 */
const NO_RETRY = /^((owner|queue|split):|merge:stage-)/u;
/** Ссылка в тексте причины; знаки препинания за ней — не часть адреса. */
const URL_RE = /https:\/\/[^\s«»"')]+[^\s«»"').,;:]/u;
/** Команда Issue в причине: «$done 07/T5», «$decide». Заготовки вроде «$done NN/Tn» — не команда. */
const ISSUE_RE = new RegExp(`«(\\$[a-z-]+(?: ${TASK_ID_SOURCE})?)»`, 'g');
const RUN_RE = /\/actions\/runs\/(\d+)/u;

/** @returns адрес новой Issue с меткой `agent` и командой в первой строке тела. */
export const issueUrl = (repo: string, command: string): string =>
  `https://github.com/${repo}/issues/new?labels=agent&title=${encodeURIComponent(command)}&body=${encodeURIComponent(`${command}\n`)}`;

/**
 * Действия ожидания по его ключу и причине.
 * @param selfClearing ожидание снимается само на следующем шаге (Enter): повтор не нужен.
 * @param repo owner/repo; без него готовую Issue не открыть.
 */
export function waitActions(
  key: string,
  reason: string,
  selfClearing: boolean,
  repo?: string,
): WaitAction[] {
  const actions: WaitAction[] = [];
  if (!selfClearing && !NO_RETRY.test(key))
    actions.push({
      kind: 'retry',
      key: 'П',
      label: key.startsWith('rounds:') ? 'дать ещё круги' : 'повторить',
    });
  const url = URL_RE.exec(reason)?.[0];
  const run = url === undefined ? undefined : RUN_RE.exec(url)?.[1];
  if (key.startsWith('slow:') && run !== undefined)
    actions.push({
      kind: 'rerun',
      key: 'З',
      label: 'перезапуск прогона',
      runId: Number(run),
    });
  if (url !== undefined) actions.push({ kind: 'open', key: 'О', label: 'ссылка', target: url });
  // Две команды в причине — два ответа: вопрос («$decide») и своя работа («$done NN/Tn»).
  const commands = [...reason.matchAll(ISSUE_RE)].flatMap((match) => match.slice(1, 2));
  if (repo !== undefined)
    commands.slice(0, 2).forEach((command, index) =>
      actions.push({
        kind: 'open',
        key: index === 0 ? 'И' : 'Д',
        label: `Issue «${command}»`,
        target: issueUrl(repo, command),
      }),
    );
  return actions;
}

/** Действие «открыть лог последней сессии codex агента», если лог есть. */
export const logAction = (file: string | undefined): WaitAction[] =>
  file === undefined ? [] : [{ kind: 'open', key: 'Л', label: 'лог сессии', target: file }];

/**
 * Открыть ссылку или файл программой ОС по умолчанию, без оболочки: `&` в адресе Issue
 * cmd принял бы за разделитель команд.
 */
export function openExternal(target: string, onError: (message: string) => void): void {
  const [command, args]: readonly [string, readonly string[]] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (error) => onError(`не открылось (${command}): ${error.message}`));
  child.unref();
}
