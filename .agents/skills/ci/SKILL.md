---
name: ci
description: Проверить статус GitHub Actions для последнего запушенного коммита ветки через REST API, без gh и без опроса в цикле. Используется в конце $task, $decide, $stage-close или по вызову $ci.
---

# $ci

Запусти `pnpm ci:wait` одной командой с таймаутом 660 с.
