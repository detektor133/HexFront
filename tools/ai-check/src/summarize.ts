// Сжатие отчёта Vitest (--reporter=json) до списка упавших проверок.

/** Подмножество JSON-отчёта Vitest, нужное для сводки. */
export interface VitestReport {
  readonly testResults: readonly {
    readonly name: string;
    readonly message?: string;
    readonly assertionResults: readonly {
      readonly fullName: string;
      readonly status: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
}

/** Оставляет первые `max` строк текста без пустых строк и без путей node_modules. */
export function trimStack(text: string, max: number): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l !== '' && !l.includes('node_modules'))
    .slice(0, max)
    .join('\n');
}

function indent(text: string): string[] {
  return text.split('\n').map((l) => `  ${l}`);
}

/** Для каждого упавшего теста — заголовок «FAIL файл > имя» и до `stackLines` строк сообщения. */
export function summarizeVitest(report: VitestReport, stackLines: number): string[] {
  const out: string[] = [];
  for (const file of report.testResults) {
    const failed = file.assertionResults.filter((a) => a.status === 'failed');
    const shortName = file.name
      .replaceAll('\\', '/')
      .replace(/^.*\/(packages|apps|tools)\//, '$1/');
    for (const a of failed) {
      out.push(`FAIL ${shortName} > ${a.fullName}`);
      const msg = trimStack(a.failureMessages?.join('\n') ?? '', stackLines);
      if (msg !== '') out.push(...indent(msg));
    }
    if (failed.length === 0 && file.message !== undefined && file.message.trim() !== '') {
      out.push(`FAIL ${shortName} (файл не запустился)`);
      out.push(...indent(trimStack(file.message, stackLines)));
    }
  }
  return out;
}
