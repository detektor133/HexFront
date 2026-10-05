import { generateMap } from '../src/index.ts';

const seed = Number(process.argv[2]);
const players = Number(process.argv[3]);

process.stdout.write(JSON.stringify(generateMap(seed, { width: 80, height: 60, players })));
