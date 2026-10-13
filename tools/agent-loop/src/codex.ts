// Одна сессия `codex exec` с моделью роли; полный вывод — в `.ai-logs/agent-loop/`, вне git.
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareProcessArguments, type CommandResult, type RunCommand } from './process.ts';

interface RoleConfig {
  readonly model?: string;
  readonly reasoningEffort: string;
}
/**
 * `next` — сессии, которые пишут код и docs; `review` — только `$review`, с правами reviewer;
 * `spec` — `$spec`, только приёмочные тесты до кода.
 */
export type Role = 'next' | 'review' | 'spec';
export interface AgentDefinitions {
  /** Роль `spec` необязательна: без неё в roles.json цикл не пишет приёмочные тесты до кода. */
  readonly roles: Readonly<Record<'next' | 'review', RoleConfig>> & { readonly spec?: RoleConfig };
  readonly reviewerPaths: readonly string[];
  readonly specPaths: readonly string[];
}
export interface CodexSettings {
  readonly root: string;
  readonly maxMinutes: number;
  readonly runCommand: RunCommand;
  readonly now: () => number;
  readonly writeLine: (line: string) => void;
}
export interface Session {
  readonly result: CommandResult;
  readonly message: string;
  readonly log: string;
  /** Сбой codex: ненулевой код или кончился лимит; undefined — сессия отработала. */
  readonly failure?: string;
}

/** Как часто печатать «сессия ещё идёт», мс. */
// Codex при исчерпанном лимите может выйти с кодом 0, поэтому лимит ищется и в тексте.
export const USAGE_LIMIT = 'кончился лимит Codex';
const USAGE_LIMIT_RE = /hit your usage limit|usage limit reached/i;
const HEARTBEAT_MS = 60_000;

export const minutes = (ms: number): string => `${Math.max(0, Math.round(ms / 60_000))} мин`;

export async function loadAgentDefinitions(root: string): Promise<AgentDefinitions> {
  const [rolesText, permissionsText] = await Promise.all([
    readFile(join(root, 'tools/agent-loop/roles.json'), 'utf8'),
    readFile(join(root, 'tools/agent-loop/permissions.json'), 'utf8'),
  ]);
  const roles = JSON.parse(rolesText) as Partial<Record<Role, RoleConfig>>;
  const permissions = JSON.parse(permissionsText) as {
    readonly reviewer?: readonly string[];
    readonly spec?: readonly string[];
  };
  if (!roles.next || !roles.review) throw new Error('В roles.json нужны роли next и review');
  return {
    roles: { next: roles.next, review: roles.review, ...(roles.spec ? { spec: roles.spec } : {}) },
    reviewerPaths: permissions.reviewer ?? [],
    specPaths: permissions.spec ?? [],
  };
}

async function saveSessionLog(
  settings: CodexSettings,
  prompt: string,
  result: CommandResult,
): Promise<string> {
  const directory = join(settings.root, '.ai-logs', 'agent-loop');
  await mkdir(directory, { recursive: true });
  const name = `${new Date(settings.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`;
  const text = `$ codex exec: ${prompt}\nкод: ${result.code}\n\n${result.stdout}\n\n--- stderr ---\n${result.stderr}\n`;
  await appendFile(join(directory, name), text, 'utf8');
  return `.ai-logs/agent-loop/${name}`;
}

/** Новая сессия `codex exec`; промпт идёт через stdin дословно. */
export async function runCodex(
  settings: CodexSettings,
  definitions: AgentDefinitions,
  role: Role,
  prompt: string,
  /** Приёмочные тесты, которые сессия не может менять (`AGENT_LOCKED` для хука прав). */
  locked: readonly string[] = [],
): Promise<Session> {
  const roleConfig = role === 'spec' ? definitions.roles.spec : definitions.roles[role];
  if (roleConfig === undefined) throw new Error('В roles.json нет роли spec');
  const outputDir = await mkdtemp(join(tmpdir(), 'hexfront-agent-'));
  const outputFile = join(outputDir, 'last-message.txt');
  const started = settings.now();
  const title = prompt.split(/\r?\n/, 1)[0] ?? prompt;
  const heartbeat = setInterval(
    () => settings.writeLine(`  … ${title} идёт ${minutes(settings.now() - started)}`),
    HEARTBEAT_MS,
  );
  let result: CommandResult;
  try {
    result = await settings.runCommand(
      'codex',
      prepareProcessArguments([
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(roleConfig.model ? ['--model', roleConfig.model] : []),
        '-c',
        `model_reasoning_effort=${roleConfig.reasoningEffort}`,
        '--output-last-message',
        outputFile,
        '--cd',
        settings.root,
        '-',
      ]),
      {
        cwd: settings.root,
        // Роль задаётся явно: унаследованный AGENT_ROLE не должен ограничить или расширить сессию.
        env: {
          ...process.env,
          AGENT_ROLE: role === 'review' ? 'reviewer' : role === 'spec' ? 'spec' : '',
          AGENT_LOCKED: locked.join('\n'),
        },
        input: prompt,
        timeoutMs: settings.maxMinutes * 60_000,
      },
    );
  } finally {
    clearInterval(heartbeat);
  }
  const message = await readFile(outputFile, 'utf8').catch(
    (error: unknown) => `${result.stdout}\n(последний ответ не записан: ${String(error)})`,
  );
  await rm(outputDir, { recursive: true, force: true });
  const log = await saveSessionLog(settings, prompt, result);
  // Только итог и хвост stderr: в stdout сессии лимит может встретиться в читаемых файлах.
  const tail = result.stderr.trim().split(/\r?\n/).slice(-20).join('\n');
  const failure = USAGE_LIMIT_RE.test(`${message}\n${tail}`)
    ? USAGE_LIMIT
    : result.code !== 0
      ? `codex завершился с кодом ${result.code}`
      : undefined;
  return { result, message, log, ...(failure === undefined ? {} : { failure }) };
}
