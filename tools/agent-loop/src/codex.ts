// Одна сессия `codex exec` с моделью роли; полный вывод — в `.ai-logs/agent-loop/`, вне git.
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CommandResult, RunCommand } from './process.ts';

interface RoleConfig {
  readonly model?: string;
  readonly reasoningEffort: string;
}
/**
 * `next` — сессии, которые пишут код и docs; `review` — только `$review`, с правами reviewer;
 * `spec` — ручной `$spec`, отдельная подготовка тестов; `plan` — `$plan`, проверка текста
 * задачи перед исполнителем (файл этапа, STATUS, QUESTIONS, DECISIONS).
 */
export type Role = 'next' | 'review' | 'spec' | 'plan';
export interface AgentDefinitions {
  /** Роли `spec` и `plan` необязательны: без них в roles.json цикл работает по-старому. */
  readonly roles: Readonly<Record<'next' | 'review', RoleConfig>> & {
    readonly spec?: RoleConfig;
    readonly plan?: RoleConfig;
  };
  readonly reviewerPaths: readonly string[];
  readonly specPaths: readonly string[];
  readonly planPaths: readonly string[];
}
export interface CodexSettings {
  readonly root: string;
  readonly maxMinutes: number;
  readonly runCommand: RunCommand;
  readonly now: () => number;
  readonly writeLine: (line: string) => void;
  readonly env?: Readonly<Record<string, string>>;
  /** Панель консоли сама показывает, сколько идёт сессия: строки «идёт N мин» не нужны. */
  readonly board?: object;
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
const TOOL_SETUP_RE = /^Failed to create unified exec process:/u;
const HEARTBEAT_MS = 60_000;

export const minutes = (ms: number): string => `${Math.max(0, Math.round(ms / 60_000))} мин`;

export function codexFailure(message: string, stderr: string, code: number): string | undefined {
  if (code !== 0 && TOOL_SETUP_RE.test(stderr.trimStart())) return 'инструмент Codex не запустился';
  const tail = stderr.trim().split(/\r?\n/u).slice(-20).join('\n');
  if (USAGE_LIMIT_RE.test(`${message}\n${tail}`)) return USAGE_LIMIT;
  return code === 0 ? undefined : `codex завершился с кодом ${code}`;
}

export async function loadAgentDefinitions(root: string): Promise<AgentDefinitions> {
  const [rolesText, permissionsText] = await Promise.all([
    readFile(join(root, 'tools/agent-loop/roles.json'), 'utf8'),
    readFile(join(root, 'tools/agent-loop/permissions.json'), 'utf8'),
  ]);
  const roles = JSON.parse(rolesText) as Partial<Record<Role, RoleConfig>>;
  const permissions = JSON.parse(permissionsText) as {
    readonly reviewer?: readonly string[];
    readonly spec?: readonly string[];
    readonly plan?: readonly string[];
  };
  if (!roles.next || !roles.review) throw new Error('В roles.json нужны роли next и review');
  return {
    roles: {
      next: roles.next,
      review: roles.review,
      ...(roles.spec ? { spec: roles.spec } : {}),
      ...(roles.plan ? { plan: roles.plan } : {}),
    },
    reviewerPaths: permissions.reviewer ?? [],
    specPaths: permissions.spec ?? [],
    planPaths: permissions.plan ?? [],
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
  /** Снимки, приложенные к промпту как изображения (`codex exec -i <file>...`), не пути текстом. */
  images: readonly string[] = [],
): Promise<Session> {
  const roleConfig =
    role === 'spec'
      ? definitions.roles.spec
      : role === 'plan'
        ? definitions.roles.plan
        : definitions.roles[role];
  if (roleConfig === undefined) throw new Error(`В roles.json нет роли ${role}`);
  const outputDir = await mkdtemp(join(tmpdir(), 'hexfront-agent-'));
  const outputFile = join(outputDir, 'last-message.txt');
  const started = settings.now();
  const title = prompt.split(/\r?\n/, 1)[0] ?? prompt;
  const heartbeat = setInterval(() => {
    if (settings.board === undefined)
      settings.writeLine(`  … ${title} идёт ${minutes(settings.now() - started)}`);
  }, HEARTBEAT_MS);
  let result: CommandResult;
  try {
    result = await settings.runCommand(
      'codex',
      [
        'exec',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(images.length > 0 ? ['-i', ...images] : []),
        ...(roleConfig.model ? ['--model', roleConfig.model] : []),
        ...(role === 'review' || role === 'plan'
          ? [
              '--output-schema',
              join(
                settings.root,
                'tools/agent-loop/schemas',
                `${role === 'review' && images.length > 0 ? 'visual' : role}.json`,
              ),
            ]
          : []),
        '-c',
        `model_reasoning_effort=${roleConfig.reasoningEffort}`,
        '--output-last-message',
        outputFile,
        '--cd',
        settings.root,
        '-',
      ],
      {
        cwd: settings.root,
        // Роль задаётся явно: унаследованный AGENT_ROLE не должен ограничить или расширить сессию.
        env: {
          ...process.env,
          ...settings.env,
          AGENT_NO_PUSH: '1',
          AGENT_ROLE:
            role === 'review' ? 'reviewer' : role === 'spec' ? 'spec' : role === 'plan' ? role : '',
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
    () => result.stdout.trim() || 'Последний ответ Codex не записан',
  );
  await rm(outputDir, { recursive: true, force: true });
  const log = await saveSessionLog(settings, prompt, result);
  // Только итог и хвост stderr: в stdout сессии лимит может встретиться в читаемых файлах.
  const failure = codexFailure(message, result.stderr, result.code);
  return { result, message, log, ...(failure === undefined ? {} : { failure }) };
}
