import { generateMap, QUICK_MATCH_MAP_SIZE } from '../src/index.ts';

const seed = Number(process.argv[2]);
const players = Number(process.argv[3]);

process.stdout.write(JSON.stringify(generateMap(seed, { ...QUICK_MATCH_MAP_SIZE, players })));
