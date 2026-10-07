# Agent loop

`pnpm agent:run [--max-tasks=3] [--max-minutes=N] [--dry-run]` запускает planner, tester, coder и reviewer отдельными сессиями `codex exec`.

Проверено командой `codex exec --help`: `--dangerously-bypass-approvals-and-sandbox` отключает подтверждения и sandbox, `--model` выбирает модель, `-c model_reasoning_effort="high|medium"` задаёт усилие, `--output-last-message <file>` сохраняет последний ответ, а `--json` выдаёт JSONL-события. Отдельного флага расхода токенов нет; оркестратор ищет `total_tokens`/`tokens` в stdout JSONL, если текущая версия CLI их возвращает.

Codex пишет через `Bash`/`exec_command` и `apply_patch`. Официальный `PreToolUse` получает `tool_name` и `tool_input`; `.codex/hooks.json` подключает `agent-permissions.mjs` для `Bash`, `apply_patch`, `Edit` и `Write`. Хук блокирует распознаваемые записи вне `permissions.json` через `permissionDecision=deny`.

Произвольный shell-скрипт может скрыть путь, поэтому после каждого вызова оркестратор проверяет diff и незакоммиченные файлы относительно исходного коммита. Это покрывает записи, которые hook не распознал. Без `AGENT_ROLE` hook ничего не блокирует, поэтому ручной режим сохраняет текущие права владельца.

Issues читаются через `GITHUB_TOKEN`. Ответ `403` при комментарии или закрытии Issue означает, что токену нужно право `Issues: write`; `pnpm ci:wait` использует тот же токен для Actions.
