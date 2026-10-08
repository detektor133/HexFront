import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const role = process.env.AGENT_ROLE;
if (!role) process.exit(0);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`agent-permissions: не удалось прочитать ${path}: ${String(error)}\n`);
    process.exit(2);
  }
}

const permissions = readJson(resolve(process.cwd(), 'tools/agent-loop/permissions.json'));
function matches(glob, name) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '__DOUBLE_STAR__')
    .replaceAll('*', '[^/]*')
    .replaceAll('__DOUBLE_STAR__', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}
function allowed(name) {
  const normalized = relative(process.cwd(), resolve(process.cwd(), name)).replaceAll('\\', '/');
  return permissions[role]?.some((glob) => matches(glob, normalized)) ?? false;
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
function addTarget(targets, value) {
  if (!value || /^&[12]$|^\$null$|^NUL$/i.test(value)) return;
  targets.push(value.replace(/^['"]|['"]$/g, ''));
}
function bashTargets(command) {
  const targets = [];
  for (const match of command.matchAll(/(?:^|\s)(?:>{1,2})(?!&)(?:\s*)([^\s;&|]+)/g))
    addTarget(targets, match[1]);
  for (const commandName of [
    'Set-Content',
    'Out-File',
    'New-Item',
    'Remove-Item',
    'Move-Item',
    'Copy-Item',
  ]) {
    const pattern = new RegExp(
      `\\b${commandName}\\b[^;&|]*?(?:-Path|-FilePath|-Destination)\\s+([^\\s;&|]+)`,
      'ig',
    );
    for (const match of command.matchAll(pattern)) addTarget(targets, match[1]);
  }
  return targets;
}
function patchTargets(input) {
  const command = typeof input.command === 'string' ? input.command : '';
  const targets = [...command.matchAll(/\*\*\* (?:Add|Update|Delete) File:\s+([^\r\n]+)/g)].map(
    (match) => match[1],
  );
  if (typeof input.file_path === 'string') targets.push(input.file_path);
  if (typeof input.path === 'string') targets.push(input.path);
  return targets;
}

const event = (() => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
})();
const input = event.tool_input ?? {};
const targets =
  event.tool_name === 'Bash'
    ? bashTargets(typeof input.command === 'string' ? input.command : '')
    : patchTargets(input);
if (targets.some((target) => !allowed(target)))
  deny(`AGENT_ROLE=${role} не может изменять: ${targets.join(', ')}`);
