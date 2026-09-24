// Границы пакетов из docs/architecture/overview.md, раздел «Границы».
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sim-imports-nothing',
      comment: 'sim не импортирует ничего вне себя: ни пакеты, ни Node API, ни npm.',
      severity: 'error',
      from: { path: '^packages/sim/src' },
      to: { pathNot: '^packages/sim/src' },
    },
    {
      name: 'sim-no-core-modules',
      severity: 'error',
      from: { path: '^packages/sim/src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'protocol-only-sim',
      comment: 'protocol может импортировать только sim (и только типы).',
      severity: 'error',
      from: { path: '^packages/protocol/' },
      to: { path: '^(packages|apps|tools)/', pathNot: '^packages/(protocol|sim)/' },
    },
    {
      name: 'protocol-sim-types-only',
      severity: 'error',
      from: { path: '^packages/protocol/' },
      to: { path: '^packages/sim/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'mapgen-only-sim',
      severity: 'error',
      from: { path: '^packages/mapgen/' },
      to: { path: '^(packages|apps|tools)/', pathNot: '^packages/(mapgen|sim)/' },
    },
    {
      name: 'server-boundaries',
      severity: 'error',
      from: { path: '^apps/server/' },
      to: {
        path: '^(packages|apps|tools)/',
        pathNot: '^(apps/server|packages/(sim|protocol|mapgen))/',
      },
    },
    {
      name: 'client-boundaries',
      severity: 'error',
      from: { path: '^apps/client/' },
      to: { path: '^(packages|apps|tools)/', pathNot: '^(apps/client|packages/(sim|protocol))/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // Фикстура нарочно нарушает границы; её проверяет packages/sim/test/guards.
    exclude: { path: ['node_modules', '/test/fixtures/', '/dist/'] },
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.json'],
    },
  },
};
