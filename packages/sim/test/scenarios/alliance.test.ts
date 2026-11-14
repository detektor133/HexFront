import { describe, expect, it } from 'vitest';

import { applyCommands, validate } from '../../src/commands/apply.ts';
import { diplomacyView } from '../../src/queries/player-view.ts';
import { atWar, createDiplomacy, relationOf, setRelation } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  b  b  B1 c  c  C1 d  d  D1
  a  a  a  b  b  b  c  c  c  d  d  d
  a  a  a  b  b  b  c  c  c  d  d  d
`;
const legend = {
  A1: city('A', 3, { capital: true }),
  B1: city('B', 3, { capital: true }),
  C1: city('C', 3, { capital: true }),
  D1: city('D', 3, { capital: true }),
  a: own('A'),
  b: own('B'),
  c: own('C'),
  d: own('D'),
};

function game() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  return s;
}
type G = ReturnType<typeof game>;
const cmd = (s: G, playerId: number, c: Parameters<typeof applyCommands>[1][number]['cmd']) =>
  applyCommands(s.state, [{ playerId, cmd: c }]);
const rel = (s: G, a: number, b: number) => relationOf(s.state, a, b);
// Игроки: A=0, B=1, C=2, D=3.
function treaty(s: G, from: number, to: number, kind: 'pact' | 'defense' | 'alliance') {
  cmd(s, from, { t: 'proposeTreaty', target: to, kind });
  cmd(s, to, { t: 'answerTreaty', from, accept: true });
}

describe('оборонительный пакт', () => {
  it('нападение на партнёра даёт запрос помощи; согласие — война агрессору и общий обзор', () => {
    const s = game();
    treaty(s, 0, 1, 'defense');
    expect(rel(s, 0, 1)).toBe('defense');
    cmd(s, 2, { t: 'declareWar', target: 1 });
    expect(diplomacyView(s.state, 0)?.aidCalls).toEqual([{ victim: 1, aggressor: 2 }]);
    expect(atWar(s.state, 0, 2)).toBe(false);
    cmd(s, 0, { t: 'answerAid', aggressor: 2, join: true });
    expect(atWar(s.state, 0, 2)).toBe(true);
    expect(rel(s, 0, 1)).toBe('defense');
    expect(s.state.diplomacy?.aid).toEqual([{ ally: 0, victim: 1, aggressor: 2 }]);
    expect(s.state.diplomacy?.violations[0]).toBe(0);
  });

  it('отказ и молчание аннулируют пакт без нарушения', () => {
    const s = game();
    treaty(s, 0, 1, 'defense');
    cmd(s, 2, { t: 'declareWar', target: 1 });
    cmd(s, 0, { t: 'answerAid', aggressor: 2, join: false });
    expect(rel(s, 0, 1)).toBe('peace');
    expect(s.state.diplomacy?.violations[0]).toBe(0);

    const t = game();
    treaty(t, 0, 1, 'defense');
    cmd(t, 2, { t: 'declareWar', target: 1 });
    t.runTicks(301);
    expect(rel(t, 0, 1)).toBe('peace');
    expect(diplomacyView(t.state, 0)?.aidCalls).toEqual([]);
  });

  it('когда война кончается, отряды помощника на земле союзника возвращаются домой', () => {
    const s = game();
    treaty(s, 0, 1, 'defense');
    cmd(s, 2, { t: 'declareWar', target: 1 });
    cmd(s, 0, { t: 'answerAid', aggressor: 2, join: true });
    const id = s.unit('A', 'infantry', 100, at(4, 1));
    cmd(s, 0, { t: 'breakTreaty', target: 1 });
    s.runTicks(1);
    // Пакт разорван — помощь кончилась: отряд на чужой земле идёт к своей.
    const unit = s.state.units.find((u) => u.id === id);
    expect(unit?.order).toBe('move');
    // Дошёл до своей земли — проход закрывается.
    s.runSeconds(60);
    expect(s.state.hexes.owner[s.state.units.find((u) => u.id === id)?.hex ?? 0]).toBe(0);
    expect(s.state.diplomacy?.aid).toEqual([]);
  });
});

describe('альянс', () => {
  it('альянс посреди войны: союзник вступает в неё против врага воюющего', () => {
    const s = game();
    cmd(s, 0, { t: 'declareWar', target: 3 });
    expect(atWar(s.state, 1, 3)).toBe(false);
    treaty(s, 0, 1, 'alliance');
    expect(rel(s, 0, 1)).toBe('alliance');
    expect(atWar(s.state, 1, 3)).toBe(true);
  });

  it('война одному члену — война всем членам', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    cmd(s, 3, { t: 'declareWar', target: 0 });
    expect(atWar(s.state, 3, 0)).toBe(true);
    expect(atWar(s.state, 3, 1)).toBe(true);
    // Члены альянса агрессора вступают за него.
    const t = game();
    treaty(t, 2, 3, 'alliance');
    cmd(t, 2, { t: 'declareWar', target: 0 });
    expect(atWar(t.state, 3, 0)).toBe(true);
  });

  it('долг альянса сильнее пакта: член с пактом против врага всё равно вступает в войну', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    treaty(s, 1, 3, 'pact');
    cmd(s, 0, { t: 'declareWar', target: 3 });
    expect(atWar(s.state, 1, 3)).toBe(true);
    expect(s.state.diplomacy?.violations[1]).toBe(0);
  });

  it('вход в альянс решает большинство: двое «за» из двух — вошёл, один «против» — отказ', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    cmd(s, 2, { t: 'proposeTreaty', target: 0, kind: 'alliance' });
    cmd(s, 0, { t: 'answerTreaty', from: 2, accept: true });
    const [vote] = s.state.diplomacy?.votes ?? [];
    expect(vote?.voters).toEqual([0, 1]);
    expect(diplomacyView(s.state, 1)?.votes).toHaveLength(1);
    cmd(s, 1, { t: 'castVote', voteId: vote?.id ?? -1, yes: true });
    expect(rel(s, 2, 0)).toBe('alliance');
    expect(rel(s, 2, 1)).toBe('alliance');

    const t = game();
    treaty(t, 0, 1, 'alliance');
    cmd(t, 2, { t: 'proposeTreaty', target: 0, kind: 'alliance' });
    cmd(t, 0, { t: 'answerTreaty', from: 2, accept: true });
    cmd(t, 1, { t: 'castVote', voteId: t.state.diplomacy?.votes?.[0]?.id ?? -1, yes: false });
    expect(rel(t, 2, 0)).toBe('peace');
    expect(t.state.diplomacy?.votes).toEqual([]);
  });

  it('мир с общим врагом — общий, по большинству голосов всех сторон', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    treaty(s, 2, 3, 'alliance');
    for (const a of [0, 1]) for (const b of [2, 3]) setRelation(s.state, a, b, 'war');
    cmd(s, 3, { t: 'proposeTreaty', target: 0, kind: 'peace' });
    cmd(s, 0, { t: 'answerTreaty', from: 3, accept: true });
    const vote = s.state.diplomacy?.votes?.[0];
    expect(vote?.kind).toBe('peace');
    expect(vote?.voters).toEqual([0, 1, 2, 3]);
    expect(rel(s, 1, 2)).toBe('war');
    cmd(s, 1, { t: 'castVote', voteId: vote?.id ?? -1, yes: true });
    // Сторона врага тоже голосует отдельно: пока её второй член молчит, мира нет.
    expect(rel(s, 0, 2)).toBe('war');
    cmd(s, 2, { t: 'castVote', voteId: vote?.id ?? -1, yes: true });
    for (const a of [0, 1]) for (const b of [2, 3]) expect(rel(s, a, b)).toBe('peace');
  });

  it('союзник принял мир врага сам — мира без моего голоса нет, голосование ждёт меня', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    setRelation(s.state, 0, 3, 'war');
    setRelation(s.state, 1, 3, 'war');
    cmd(s, 3, { t: 'proposeTreaty', target: 1, kind: 'peace' });
    cmd(s, 1, { t: 'answerTreaty', from: 3, accept: true });
    expect(rel(s, 0, 3)).toBe('war');
    expect(rel(s, 1, 3)).toBe('war');
    const view = diplomacyView(s.state, 0);
    expect(view?.votes).toHaveLength(1);
    expect(view?.votes[0]?.mine).toBeNull();
    cmd(s, 0, { t: 'castVote', voteId: view?.votes[0]?.id ?? -1, yes: false });
    expect(rel(s, 0, 3)).toBe('war');
    expect(s.state.diplomacy?.votes).toEqual([]);
  });

  it('голосование без решения по сроку — отказ; выход из альянса — мир со всеми и нарушение', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    cmd(s, 2, { t: 'proposeTreaty', target: 0, kind: 'alliance' });
    cmd(s, 0, { t: 'answerTreaty', from: 2, accept: true });
    s.runTicks(601);
    expect(s.state.diplomacy?.votes).toEqual([]);
    expect(rel(s, 2, 0)).toBe('peace');
    cmd(s, 0, { t: 'breakTreaty', target: 1 });
    expect(rel(s, 0, 1)).toBe('peace');
    expect(s.state.diplomacy?.violations[0]).toBe(1);
  });

  it('объявить войну члену своего альянса — предательство: альянс против предателя', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    cmd(s, 0, { t: 'proposeTreaty', target: 2, kind: 'alliance' });
    cmd(s, 2, { t: 'answerTreaty', from: 0, accept: true });
    cmd(s, 1, { t: 'castVote', voteId: s.state.diplomacy?.votes?.[0]?.id ?? -1, yes: true });
    expect(rel(s, 0, 2)).toBe('alliance');
    cmd(s, 0, { t: 'declareWar', target: 1 });
    expect(atWar(s.state, 0, 1)).toBe(true);
    expect(atWar(s.state, 0, 2)).toBe(true);
    expect(rel(s, 1, 2)).toBe('alliance');
    expect(s.state.diplomacy?.violations[0]).toBe(1);
  });

  it('исключение: голосуют остальные члены, исключённый уходит в мир, итог виден всем', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    cmd(s, 0, { t: 'proposeTreaty', target: 2, kind: 'alliance' });
    cmd(s, 2, { t: 'answerTreaty', from: 0, accept: true });
    cmd(s, 1, { t: 'castVote', voteId: s.state.diplomacy?.votes?.[0]?.id ?? -1, yes: true });
    expect(rel(s, 1, 2)).toBe('alliance');

    cmd(s, 0, { t: 'proposeExpel', target: 2 });
    const vote = s.state.diplomacy?.votes?.[0];
    expect(vote?.kind).toBe('kick');
    expect(vote?.voters).toEqual([0, 1]);
    // Исключаемый смотрит, но не голосует.
    const watched = diplomacyView(s.state, 2)?.votes[0];
    expect(watched?.canVote).toBe(false);
    cmd(s, 1, { t: 'castVote', voteId: vote?.id ?? -1, yes: true });
    expect(rel(s, 0, 2)).toBe('peace');
    expect(rel(s, 1, 2)).toBe('peace');
    expect(rel(s, 0, 1)).toBe('alliance');
    // Итог остаётся в снимке: у инициатора и у исключённого.
    expect(diplomacyView(s.state, 0)?.votes.find((v) => v.id === vote?.id)?.result).toBe('passed');
    expect(diplomacyView(s.state, 2)?.votes.find((v) => v.id === vote?.id)?.result).toBe('passed');
    s.runTicks(301);
    expect(diplomacyView(s.state, 0)?.votes).toEqual([]);
  });

  it('отклонённое исключение и вход не повторяются сразу: пауза против спама', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    cmd(s, 0, { t: 'proposeTreaty', target: 2, kind: 'alliance' });
    cmd(s, 2, { t: 'answerTreaty', from: 0, accept: true });
    cmd(s, 1, { t: 'castVote', voteId: s.state.diplomacy?.votes?.[0]?.id ?? -1, yes: true });
    cmd(s, 0, { t: 'proposeExpel', target: 2 });
    cmd(s, 1, { t: 'castVote', voteId: s.state.diplomacy?.votes?.[0]?.id ?? -1, yes: false });
    expect(rel(s, 1, 2)).toBe('alliance');
    // Тот же игрок и тот же инициатор: пауза.
    expect(validate(s.state, 0, { t: 'proposeExpel', target: 2 }).ok).toBe(false);
    expect(validate(s.state, 1, { t: 'proposeExpel', target: 2 }).ok).toBe(false);
    expect(validate(s.state, 0, { t: 'proposeExpel', target: 1 }).ok).toBe(false);
    s.runTicks(3001);
    expect(validate(s.state, 0, { t: 'proposeExpel', target: 2 }).ok).toBe(true);
  });

  it('исключение требует две трети: один голос из трёх не хватает', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    for (const [from, to] of [
      [0, 2],
      [0, 3],
    ] as const) {
      cmd(s, from, { t: 'proposeTreaty', target: to, kind: 'alliance' });
      cmd(s, to, { t: 'answerTreaty', from, accept: true });
      for (const v of [1, 2]) {
        const open = s.state.diplomacy?.votes?.[0];
        if (open && open.voters.includes(v))
          cmd(s, v, { t: 'castVote', voteId: open.id, yes: true });
      }
    }
    expect(rel(s, 2, 3)).toBe('alliance');
    cmd(s, 0, { t: 'proposeExpel', target: 3 });
    const vote = s.state.diplomacy?.votes?.[0];
    expect(vote?.voters).toEqual([0, 1, 2]);
    cmd(s, 1, { t: 'castVote', voteId: vote?.id ?? -1, yes: false });
    cmd(s, 2, { t: 'castVote', voteId: vote?.id ?? -1, yes: false });
    expect(rel(s, 0, 3)).toBe('alliance');
  });

  it('исключать нельзя, если в альянсе двое; итог отказа тоже виден', () => {
    const s = game();
    treaty(s, 0, 1, 'alliance');
    expect(validate(s.state, 0, { t: 'proposeExpel', target: 1 }).ok).toBe(false);
    cmd(s, 2, { t: 'proposeTreaty', target: 0, kind: 'alliance' });
    cmd(s, 0, { t: 'answerTreaty', from: 2, accept: true });
    const id = s.state.diplomacy?.votes?.[0]?.id ?? -1;
    cmd(s, 1, { t: 'castVote', voteId: id, yes: false });
    expect(diplomacyView(s.state, 2)?.votes.find((v) => v.id === id)?.result).toBe('failed');
  });
});
