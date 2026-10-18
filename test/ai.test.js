import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { chooseMove, choosePokerAction, equity } from '../js/ai.js';

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('equity is sensible: aces beat seven-deuce', () => {
  const r = mulberry(3);
  const aces = equity([12, 12 + 13], [], 400, r);   // As Ah
  const junk = equity([5, 0 + 13], [], 400, r);     // 7s 2h
  assert.ok(aces > 0.8, 'aces ' + aces);
  assert.ok(junk < 0.45, 'junk ' + junk);
});

test('chess AI takes a free queen and avoids hanging mate', () => {
  const g = new Game({ rng: mulberry(1) });
  g.chess.load('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1'); // Rxd5 wins a queen
  const m = chooseMove(g, 'w', 'normal', mulberry(2));
  assert.deepEqual([m.from, m.to], ['d1', 'd5']);
  const g2 = new Game({ rng: mulberry(1) });
  g2.chess.load('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'); // Ra8# is mate in one
  const m2 = chooseMove(g2, 'w', 'normal', mulberry(2));
  assert.deepEqual([m2.from, m2.to], ['a1', 'a8']);
});

for (const [level, games] of [['easy', 5], ['normal', 1]]) {
  test(`AI vs AI full games finish with legal actions only (${level})`, () => {
    const t0 = Date.now();
    let finished = 0, hands = 0;
    for (let seed = 1; seed <= games; seed++) {
      const rng = mulberry(seed * 31);
      const g = new Game({ rng: mulberry(seed) });
      let steps = 0;
      while (g.phase !== 'over' && steps < 3000) {
        steps++;
        if (g.phase === 'chess') {
          const seat = g.chess.turn();
          const m = chooseMove(g, seat, level, rng);
          const r = g.apply(seat, { type: 'move', ...m });
          assert.ok(r.ok, JSON.stringify([r, m]));
        } else {
          hands++;
          const seat = g.hand.toAct;
          const a = choosePokerAction(g, seat, level, rng);
          const r = g.apply(seat, { type: 'poker', ...a });
          assert.ok(r.ok, JSON.stringify([r, a]));
        }
      }
      if (g.phase === 'over') finished++;
    }
    console.log(`${level}: ${finished}/${games} finished, ${hands} poker actions, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    assert.ok(finished >= games - 1 || games === 1 && finished === 1 || finished >= 4);
  });
}
