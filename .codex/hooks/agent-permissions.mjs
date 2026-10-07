import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const role = process.env.AGENT_ROLE;
if (!role) process.exit(0);

function readEvent() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

const permissions = {
  planner: ['docs/stages/**', 'docs/STATUS.md', 'docs/QUESTIONS.md'],
  tester: ['**/test/**', '**/*.test.ts'],
  coder: [
    'packages/*/src/**',
    'apps/*/src/**',
    'tools/*/src/**',
    'package.json',
    '**/package.json',
    '**/tsconfig.json',
    '*.config.*',
  ],
  reviewer: ['docs/stages/**', 'docs/STATUS.md', 'docs/reports/**'],
};

function matches(glob, name) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '__DOUBLE_STAR__')
    .replaceAll('*', '[^/]*')
    .replaceAll('__DOUBLE_STAR__', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function allowed(name) {
  const normalized = relative(process.cwd(), resolve(process.cwd(), name)).replaceAll('\\', '/');
  return permissions[role]?.some((glob) => matches(glob, normalized)) ?? false;
}

const event = readEvent();
const toolName = event.tool_name;
const input = event.tool_input ?? {};
const command = typeof input.command === 'string' ? input.command : '';
const fileNames = [];
if (toolName === 'apply_patch' || toolName === 'Edit' || toolName === 'Write') {
  for (const match of command.matchAll(/\*\*\* (?:Add|Update|Delete) File:\s+([^\r\n]+)/g))
    fileNames.push(match[1]);
  if (typeof input.file_path === 'string') fileNames.push(input.file_path);
  if (typeof input.path === 'string') fileNames.push(input.path);
}
if (
  toolName === 'Bash' &&
  /(?:>\s*|>>\s*|Set-Content\b|Out-File\b|New-Item\b|Remove-Item\b|Move-Item\b|Copy-Item\b|apply_patch\b)/i.test(
    command,
  )
) {
  const candidates =
    command.match(/(?:[A-Za-z]:)?[^\s"']+(?:\.[A-Za-z0-9_-]+|\/|\\[^\s"']*)/g) ?? [];
  fileNames.push(
    ...candidates.filter(
      (name) => !/^(?:Set-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item)$/i.test(name),
    ),
  );
}
if (fileNames.some((name) => !allowed(name)))
  deny(`AGENT_ROLE=${role} не может изменять: ${fileNames.join(', ')}`);
