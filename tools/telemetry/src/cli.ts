import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { formatReport, parseTelemetry } from './report.ts';

const telemetryDir = resolve('telemetry');
const requested = process.argv[2];
const latest = (): string => {
  const files = readdirSync(telemetryDir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
  const file = files.at(-1);
  if (!file) throw new Error('Файлы телеметрии не найдены');
  return resolve(telemetryDir, file);
};

try {
  const file = requested ? resolve(requested) : latest();
  console.log(formatReport(parseTelemetry(readFileSync(file, 'utf8'))).join('\n'));
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
