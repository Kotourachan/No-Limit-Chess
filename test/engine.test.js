import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import * as P from '../js/poker.js';

const id = (r, s) => P.RANKS.indexOf(r) + 13 * P.SUIT_LETTERS.indexOf(s);

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('hand evaluator ranks categories correctly', () => {
  const ev = (cards) => P.evaluate(cards.map((c) => id(c[0], c[1])));
  const royal = ev(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']);
  const quads = ev(['9s', '9h', '9d', '9c', 'As', '2d', '3c']);
  const full = ev(['9s', '9h', '9d', 'Ac', 'As', '2d', '3c']);
  const flush = ev(['2s', '5s', '9s', 'Js', 'Ks', '2d', '3c']);
  const wheel = ev(['As', '2h', '3d', '4c', '5s', '9d', 'Kc']);
  const trips = ev(['9s', '9h', '9d', 'Ac', 'Ks', '2d', '3c']);
  const twop = ev(['9s', '9h', 'Kd', 'Kc', 'As', '2d', '3c']);
  const pair = ev(['9s', '9h', 'Kd', '4c', 'As', '2d', '3c']);
  const high = ev(['9s', 'Th', 'Kd', '4c', 'As', '2d', '7c']);
  assert.deepEqual([royal.name, quads.name, full.name, flush.name, wheel.name, trips.name, twop.name, pair.name, high.name],
    ['Straight flush', 'Four of a kind', 'Full house', 'Flush', 'Straight', 'Three of a kind', 'Two pair', 'Pair', 'High card']);
  assert.ok(royal.score > quads.score && quads.score > full.score && full.score > flush.score && flush.score > wheel.score);
  assert.ok(wheel.score > trips.score && trips.score > twop.score && twop.score > pair.score && pair.score > high.score);
  // wheel loses to a 6-high straight
  assert.ok(ev(['2s', '3h', '4d', '5c', '6s', 'Kd', '9c']).score > wheel.score);
  // kicker matters
  assert.ok(ev(['9s', '9h', 'Ad', '4c', '7s', '2d', '3c']).score > ev(['9s', '9h', 'Kd', '4c', '7s', '2d', '3c']).score);
});

test('poker: fold wins pot, chips conserved, uncalled bet returned', () => {
  const h = P.startHand({ stacks: { w: 1000, b: 1000 }, button: 'w', initiator: 'b', ante: 10, sb: 5, bb: 10, rng: mulberry(1) });
  assert.equal(h.toAct, 'w'); // button/SB acts first preflop
  assert.ok(P.act(h, 'w', { kind: 'raise', amount: 40 }).ok);
  assert.ok(P.act(h, 'b', { kind: 'fold' }).ok);
  assert.ok(h.done);
  assert.equal(h.result.winner, 'w');
  assert.equal(h.stacks.w + h.stacks.b, 2000 - 0); // ante counted in dead pot, goes to the winner
  assert.equal(h.stacks.w, 1000 + 10 + 10); // wins BB 10 + ante 10
  assert.deepEqual(h.result.reveal, { w: false, b: false });
});

test('poker: postflop action order and showdown reveal rule', () => {
  const h = P.startHand({ stacks: { w: 1000, b: 1000 }, button: 'b', initiator: 'w', ante: 0, sb: 5, bb: 10, rng: mulberry(7) });
  P.act(h, 'b', { kind: 'call' });
  P.act(h, 'w', { kind: 'check' });
  assert.equal(h.street, 'flop');
  assert.equal(h.toAct, 'w'); // non-button acts first postflop
  for (let i = 0; i < 3; i++) { // flop, turn, river all check down
    P.act(h, 'w', { kind: 'check' });
    P.act(h, 'b', { kind: 'check' });
  }
  assert.ok(h.done);
  assert.equal(h.result.reveal.w, true); // initiator always shows
  assert.equal(h.stacks.w + h.stacks.b, 2000);
});

test('poker: short stacks, all-in call, refunds', () => {
  const h = P.startHand({ stacks: { w: 100, b: 1000 }, button: 'w', initiator: 'b', ante: 0, sb: 5, bb: 10, rng: mulberry(3) });
  const o = P.options(h, 'w');
  assert.equal(o.maxRaiseTo, 100); // capped at the short stack
  P.act(h, 'w', { kind: 'allin' });
  P.act(h, 'b', { kind: 'call' });
  assert.ok(h.done);
  assert.equal(h.board.length, 5);
  assert.equal(h.stacks.w + h.stacks.b, 1100);
});

test('chess: non-capture moves never trigger poker; capture does', () => {
  const g = new Game({ rng: mulberry(5) });
  assert.ok(g.apply('w', { type: 'move', from: 'e2', to: 'e4' }).ok);
  assert.ok(g.apply('b', { type: 'move', from: 'd7', to: 'd5' }).ok);
  assert.equal(g.phase, 'chess');
  assert.ok(!g.apply('b', { type: 'move', from: 'a7', to: 'a6' }).ok); // not black's turn
  assert.ok(g.apply('w', { type: 'move', from: 'e4', to: 'd5' }).ok);
  assert.equal(g.phase, 'poker');
  assert.equal(g.pending.isRecapture, false);
  assert.deepEqual(g.match.stacks, { w: 60, b: 20 }); // pawn vs pawn: capturer 3+1+2 BB, defender 3+1-2 BB (BB = 10 chips)
  assert.equal(g.match.button, 'w'); // the capturer has the button
  assert.ok(!g.apply('w', { type: 'move', from: 'a2', to: 'a3' }).ok);
});

test('exchange stacks: 3 + piece value, plus 2 BB for the initiator: bishop takes pawn = 8 BB vs 2 BB', () => {
  const g = new Game({ rng: mulberry(9) });
  g.chess.load('4k3/5p2/8/8/2B5/8/8/4K3 w - - 0 1');
  assert.ok(g.apply('w', { type: 'move', from: 'c4', to: 'f7' }).ok);
  assert.equal(g.phase, 'poker');
  assert.deepEqual(g.match.stacks, { w: 80, b: 20 });
  assert.equal(g.hand.toAct, 'w'); // button/SB acts first preflop
  assert.equal(g.hand.sb, 5);
  assert.equal(g.hand.bb, 10); // 0.5 BB / 1 BB
});

test('no value-difference bonus: bishop takes queen = 8 BB vs 10 BB', () => {
  const g = new Game({ rng: mulberry(9) });
  g.chess.load('4k3/5q2/8/8/2B5/8/8/4K3 w - - 0 1');
  assert.ok(g.apply('w', { type: 'move', from: 'c4', to: 'f7' }).ok);
  assert.equal(g.phase, 'poker');
  assert.deepEqual(g.match.stacks, { w: 80, b: 100 });
  assert.equal(g.match.button, 'w'); // the capturer keeps the button even as the short stack
});

test('king captures are automatic (no hand)', () => {
  const g = new Game({ rng: mulberry(9) });
  g.chess.load('4k2r/8/8/8/8/8/4p3/4K3 w - - 0 1');
  assert.ok(g.apply('w', { type: 'move', from: 'e1', to: 'e2' }).ok);
  assert.equal(g.phase, 'chess');
  assert.equal(g.chess.get('e2').type, 'k');
  assert.deepEqual(g.captured.b, ['p']);
});

test('mini-match plays hands until one side is out of chips', () => {
  const g = new Game({ rng: mulberry(21) });
  g.chess.load('4k3/5p2/8/8/2B5/8/8/4K3 w - - 0 1');
  g.apply('w', { type: 'move', from: 'c4', to: 'f7' });
  let guard = 0;
  while (g.phase === 'poker' && guard++ < 500) {
    const seat = g.hand.toAct;
    const o = P.options(g.hand, seat);
    g.apply(seat, { type: 'poker', kind: o.canCheck ? 'check' : 'call' });
  }
  assert.ok(guard < 500, 'match should end');
  assert.equal(g.lastHand.button, 'w'); // the capturer keeps the button
  assert.equal(g.match, null);
  assert.ok(g.lastExchange);
  const t = g.chess.get('f7');
  if (g.lastExchange.stands) assert.equal(t.type, 'b'); else assert.equal(t.type, 'p');
});

test('recapture: recapturer is the capturer in the new match and has the button', () => {
  for (let seed = 1; seed < 200; seed++) {
    const g = new Game({ rng: mulberry(seed) });
    g.apply('w', { type: 'move', from: 'e2', to: 'e4' });
    g.apply('b', { type: 'move', from: 'd7', to: 'd5' });
    g.apply('w', { type: 'move', from: 'e4', to: 'd5' });
    let guard = 0;
    while (g.phase === 'poker' && guard++ < 500) { // black always folds, so white's capture stands
      const s = g.hand.toAct;
      g.apply(s, s === 'b' ? { type: 'poker', kind: 'fold' } : { type: 'poker', kind: P.options(g.hand, s).canCheck ? 'check' : 'call' });
    }
    if (g.chess.get('d5')?.color !== 'w') continue;
    assert.ok(g.apply('b', { type: 'move', from: 'd8', to: 'd5' }).ok);
    assert.equal(g.pending.isRecapture, true);
    assert.equal(g.match.button, 'b');
    assert.equal(g.match.capturer, 'b');
    assert.deepEqual(g.match.stacks, { b: 140, w: 20 }); // queen 3+9+2 BB vs pawn 3+1-2 BB
    return;
  }
  assert.fail('no seed produced a standing first capture');
});

test('capture stands when the capturer wins; the capturing piece is lost when they lose', () => {
  let stood = 0, failed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game({ rng: mulberry(seed) });
    g.apply('w', { type: 'move', from: 'e2', to: 'e4' });
    g.apply('b', { type: 'move', from: 'd7', to: 'd5' });
    g.apply('w', { type: 'move', from: 'e4', to: 'd5' });
    // white (capturer) shoves, black folds => stands; black shoves ... keep simple: random folder
    const folder = seed % 2 ? 'w' : 'b';
    // play passively until folder's turn then fold
    let guard = 0;
    while (g.phase === 'poker' && guard++ < 500) {
      const seat = g.hand.toAct;
      if (seat === folder) g.apply(seat, { type: 'poker', kind: 'fold' });
      else g.apply(seat, { type: 'poker', kind: P.options(g.hand, g.hand.toAct).canCheck ? 'check' : 'call' });
    }
    const piecesOnD5 = g.chess.get('d5');
    if (folder === 'b') { stood++; assert.equal(piecesOnD5.color, 'w'); assert.equal(g.chess.turn(), 'b'); }
    else { failed++; assert.equal(piecesOnD5.color, 'b'); assert.equal(g.chess.turn(), 'b'); assert.equal(g.chess.get('e4'), undefined, 'capturing pawn is lost'); assert.deepEqual(g.captured.w, ['p']); }
  }
  assert.ok(stood > 0 && failed > 0);
});

test('views hide opponent hole cards', () => {
  const g = new Game({ rng: mulberry(2) });
  g.apply('w', { type: 'move', from: 'e2', to: 'e4' });
  g.apply('b', { type: 'move', from: 'd7', to: 'd5' });
  g.apply('w', { type: 'move', from: 'e4', to: 'd5' });
  const vw = g.viewFor('w'), vb = g.viewFor('b'), vg = g.viewFor('w', { god: true });
  assert.ok(vw.hand.hole.w && !vw.hand.hole.b);
  assert.ok(vb.hand.hole.b && !vb.hand.hole.w);
  assert.ok(vg.hand.hole.w && vg.hand.hole.b);
});

test('random games: no crashes, always terminate, chip bookkeeping sane', () => {
  const stats = { over: 0, hands: 0, results: {} };
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = mulberry(seed * 977);
    const g = new Game({ rng: mulberry(seed) });
    let steps = 0;
    while (g.phase !== 'over' && steps < 8000) {
      steps++;
      if (g.phase === 'chess') {
        const seat = g.chess.turn();
        const legal = g.legalMoves();
        // prefer captures to exercise the poker engine
        const caps = legal.filter((m) => m.capture);
        const pool = caps.length && rnd() < 0.7 ? caps : legal;
        const m = pool[Math.floor(rnd() * pool.length)];
        const r = g.apply(seat, { type: 'move', from: m.from, to: m.to, promotion: m.promotion });
        assert.ok(r.ok, JSON.stringify(r));
        if (g.phase === 'poker') stats.hands++;
      } else {
        const seat = g.hand.toAct;
        const o = P.options(g.hand, seat);
        const roll = rnd();
        let a;
        if (roll < 0.15) a = { kind: 'fold' };
        else if (roll < 0.55) a = { kind: o.canCheck ? 'check' : 'call' };
        else if (roll < 0.93 && o.canRaise) a = { kind: 'raise', amount: o.minRaiseTo + Math.floor(rnd() * (o.maxRaiseTo - o.minRaiseTo + 1)) };
        else if (o.canRaise) a = { kind: 'allin' };
        else a = { kind: o.canCheck ? 'check' : 'call' };
        const r = g.apply(seat, { type: 'poker', ...a });
        assert.ok(r.ok, JSON.stringify([r, a, o]));
      }
      if (g.hand) { assert.ok(g.hand.stacks.w >= 0 && g.hand.stacks.b >= 0); assert.ok(Number.isInteger(g.hand.stacks.w) && Number.isInteger(g.hand.stacks.b)); }
    }
    if (g.phase === 'over') { stats.over++; stats.results[g.result.reason] = (stats.results[g.result.reason] || 0) + 1; }
  }
  console.log('simulation:', JSON.stringify(stats));
  assert.ok(stats.over >= 40, `too many games hit the step cap: ${stats.over}/60`);
});

function foldAlways(g, seat) {
  let guard = 0;
  while (g.phase === 'poker' && guard++ < 500) {
    const s = g.hand.toAct;
    g.apply(s, s === seat ? { type: 'poker', kind: 'fold' } : { type: 'poker', kind: P.options(g.hand, s).canCheck ? 'check' : 'call' });
  }
  assert.ok(guard < 500);
}

test('a failed capture loses the capturing piece and passes the turn', () => {
  const g = new Game({ rng: mulberry(4) });
  g.chess.load('4k3/p7/8/3n4/8/8/8/3QK3 w - - 0 1'); // Qxd5 (the pawn avoids a bare-king draw)
  g.apply('w', { type: 'move', from: 'd1', to: 'd5' });
  assert.deepEqual(g.match.stacks, { w: 140, b: 40 });
  foldAlways(g, 'w');
  assert.equal(g.phase, 'chess');
  assert.equal(g.chess.get('d1'), undefined);            // queen gone from its square
  assert.equal(g.chess.get('d5').type, 'n');             // defender untouched
  assert.deepEqual(g.captured.w, ['q']);                 // shows in White's lost-pieces tray
  assert.equal(g.chess.turn(), 'b');
  assert.equal(g.lastExchange.stands, false);
});

test('a pinned piece that fails its capture exposes its king and loses the game', () => {
  const g = new Game({ rng: mulberry(4) });
  g.chess.load('4q1k1/8/8/8/8/8/4R3/4K3 w - - 0 1'); // Re2 is pinned by the queen; Rxe8 is legal
  assert.ok(g.apply('w', { type: 'move', from: 'e2', to: 'e8' }).ok);
  foldAlways(g, 'w');
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result, { winner: 'b', reason: 'king exposed' });
});

function capturePawn(g) {
  g.apply('w', { type: 'move', from: 'e2', to: 'e4' });
  g.apply('b', { type: 'move', from: 'd7', to: 'd5' });
  g.apply('w', { type: 'move', from: 'e4', to: 'd5' });
}

test('manual advance: finished hand stays on the table until tick() after the pause', () => {
  let t = 1000;
  const g = new Game({ rng: mulberry(6), manualAdvance: true, actionMs: 10000, pauseMs: 3000, now: () => t });
  capturePawn(g);
  assert.equal(g.phase, 'poker');
  assert.equal(g.viewFor('w').actionMs, 10000);
  assert.equal(g.hand.toAct, 'w');
  g.apply('w', { type: 'poker', kind: 'fold' });
  assert.equal(g.phase, 'poker');
  assert.ok(g.hand.done);
  const v = g.viewFor('b');
  assert.equal(v.hand.done, true);
  assert.equal(v.hand.result.winner, 'b');
  assert.deepEqual(v.hand.acts.w.kind, 'fold');
  assert.equal(v.hand.lastActor, 'w');
  assert.deepEqual(v.hand.endBets, { w: 5, b: 10 });   // what was on the table when the hand ended
  assert.equal(v.actionMs, 0);
  assert.equal(g.apply('b', { type: 'poker', kind: 'check' }).ok, false);
  t += 2999; assert.equal(g.tick(), false);
  t += 2; assert.equal(g.tick(), true);
  assert.equal(g.hand.done, false);           // next hand of the same mini-match
  assert.equal(g.hand.id, 2);
  assert.equal(g.match.button, 'w');          // capturer keeps the button
});

test('intro and deal hold: nobody can act and the clock starts when the hold ends', () => {
  let t = 0;
  const g = new Game({ rng: mulberry(8), manualAdvance: true, actionMs: 20000, introMs: 12300, dealMs: 2800, now: () => t });
  capturePawn(g);
  assert.equal(g.viewFor('w').holdMs, 15100);               // first hand of an exchange: pop-up + deal
  assert.equal(g.viewFor('w').introMs, 12300);
  assert.equal(g.viewFor('w').actionMs, 15100 + 20000);     // the clock only runs after the hold
  assert.equal(g.apply('w', { type: 'poker', kind: 'call' }).ok, false);
  t += 15099; assert.equal(g.tick(), false);
  t += 2; assert.equal(g.tick(), true);                     // hold over, state changed so views get pushed
  assert.equal(g.viewFor('w').holdMs, 0);
  assert.ok(g.apply('w', { type: 'poker', kind: 'call' }).ok);
});

test('2 second buffer after every decision, and the next clock starts after it', () => {
  let t = 0;
  const g = new Game({ rng: mulberry(8), manualAdvance: true, actionMs: 20000, bufferMs: 2000, now: () => t });
  capturePawn(g);
  assert.ok(g.apply('w', { type: 'poker', kind: 'raise', amount: 20 }).ok);
  const v = g.viewFor('b');
  assert.equal(v.hand.toAct, 'b');
  assert.equal(v.holdMs, 2000);
  assert.equal(v.actionMs, 22000);
  assert.equal(g.apply('b', { type: 'poker', kind: 'call' }).ok, false);   // still showing white's raise
  t += 1999; assert.equal(g.tick(), false);
  t += 2; assert.equal(g.tick(), true);
  assert.ok(g.apply('b', { type: 'poker', kind: 'call' }).ok);
});

test('action clock: out of time checks when free, folds when facing a bet', () => {
  let t = 0;
  const g = new Game({ rng: mulberry(8), manualAdvance: true, actionMs: 10000, pauseMs: 3000, now: () => t });
  capturePawn(g);
  t += 10001;
  assert.equal(g.tick(), true);                  // white (small blind) faces 5 more: times out -> folds
  assert.equal(g.hand.result.winner, 'b');
  assert.deepEqual(g.hand.acts.w.kind, 'fold');
  const g2 = new Game({ rng: mulberry(8), manualAdvance: true, actionMs: 10000, pauseMs: 3000, now: () => t });
  capturePawn(g2);
  g2.apply('w', { type: 'poker', kind: 'call' });
  assert.equal(g2.hand.toAct, 'b');
  t += 10001;
  assert.equal(g2.tick(), true);
  assert.equal(g2.hand.acts.b.kind, 'check');    // free to check, so no fold
  assert.equal(g2.hand.street, 'flop');
  assert.equal(g2.hand.sweep.from, 'preflop');   // the street's bets were swept into the pot
  assert.deepEqual(g2.hand.sweep.bets, { w: 10, b: 10 });
});

test('overtime: 30s bank per player is used after the clock, drains, and refills every exchange', () => {
  let t = 0;
  const mk = () => new Game({ rng: mulberry(8), manualAdvance: true, actionMs: 10000, overtimeMs: 30000, pauseMs: 3000, now: () => t });
  const g = mk();
  capturePawn(g);
  assert.deepEqual(g.viewFor('w').overtime, { w: 30000, b: 30000 });
  t += 10001;
  assert.equal(g.tick(), true);                         // enters overtime, no action taken yet
  assert.equal(g.hand.acts.w, null);
  let v = g.viewFor('w');
  assert.equal(v.clockMode, 'ot');
  assert.equal(v.actionTotal, 30000);
  assert.ok(v.actionMs > 29900 && v.actionMs <= 30000 - 1);
  t += 5000;                                            // white thinks 5 more seconds, then calls
  assert.ok(g.apply('w', { type: 'poker', kind: 'call' }).ok);
  assert.ok(Math.abs(g.ot.w - (30000 - 5001)) <= 2, 'bank drained by the time used: ' + g.ot.w);
  assert.equal(g.ot.b, 30000);
  v = g.viewFor('b');
  assert.equal(v.clockMode, 'main');                    // black starts on the normal clock again
  assert.equal(v.actionTotal, 10000);
  // black burns the clock and the whole bank
  t += 10001; assert.equal(g.tick(), true);
  assert.equal(g.viewFor('b').clockMode, 'ot');
  t += 30001; assert.equal(g.tick(), true);
  assert.equal(g.hand.acts.b.kind, 'check');            // free to check once everything ran out
  assert.equal(g.ot.b, 0);
  // a new exchange gives everyone a full bank again
  const g2 = mk();
  capturePawn(g2);
  assert.deepEqual(g2.ot, { w: 30000, b: 30000 });
  // finish the first exchange: banks refill for the next capture
  let guard = 0;
  while (g.phase === 'poker' && guard++ < 500) {
    if (g.hand.done) { t += 3001; g.tick(); continue; }
    const s = g.hand.toAct;
    g.apply(s, { type: 'poker', kind: P.options(g.hand, s).canCheck ? 'check' : 'call' });
    t += 2100; g.tick();
  }
  assert.equal(g.phase, 'chess');
});

test('views carry each seat last action, blinds positions and BB size', () => {
  const g = new Game({ rng: mulberry(12), manualAdvance: true });
  g.apply('w', { type: 'move', from: 'e2', to: 'e4' });
  g.apply('b', { type: 'move', from: 'd7', to: 'd5' });
  g.apply('w', { type: 'move', from: 'e4', to: 'd5' });
  g.apply('w', { type: 'poker', kind: 'raise', amount: 20 });
  const v = g.viewFor('b');
  assert.equal(v.hand.acts.w.kind, 'raise');
  assert.equal(v.hand.acts.w.to, 20);
  assert.equal(v.hand.button, 'w');
  assert.equal(v.hand.sb, 5);
  assert.equal(v.hand.bb, 10);
  assert.equal(v.bb, 10);
  assert.ok(!v.hand.options.maxRaiseTo || v.hand.options.maxRaiseTo <= 20);  // defender has only 2 BB, so no re-raise past all-in
  assert.equal(v.hand.lastActor, 'w');
  assert.equal(v.hand.sweep, null);              // nothing swept yet this hand
});

test('in check: a non-king capture plays a hand; losing it leaves the king in check and loses the game', () => {
  const g = new Game({ rng: mulberry(4) });
  g.chess.load('4k3/8/8/8/8/3p4/4q3/3QK3 w - - 0 1'); // Qd1xe2 escapes check (the queen is covered by the d3 pawn)
  assert.ok(g.chess.inCheck());
  assert.ok(g.apply('w', { type: 'move', from: 'd1', to: 'e2' }).ok);
  assert.equal(g.phase, 'poker');                        // a hand is played, not free
  foldAlways(g, 'w');
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result, { winner: 'b', reason: 'checkmate' });
});

test('in check: the king captures for free', () => {
  const g = new Game({ rng: mulberry(4) });
  g.chess.load('4k3/8/8/8/8/8/3q4/4K3 w - - 0 1'); // Kxd2 is legal (queen unprotected)
  assert.ok(g.chess.inCheck());
  assert.ok(g.apply('w', { type: 'move', from: 'e1', to: 'd2' }).ok);
  assert.notEqual(g.phase, 'poker');
});

test('staged all-in run-out: the board comes out one street at a time, then a pause, then the result', () => {
  let t = 0;
  const g = new Game({ rng: mulberry(21), now: () => t, manualAdvance: true, runoutFirstMs: 1000, runoutStepMs: 500, runoutStallMs: 800, pauseMs: 100000 });
  g.apply('w', { type: 'move', from: 'e2', to: 'e4' });
  g.apply('b', { type: 'move', from: 'd7', to: 'd5' });
  g.apply('w', { type: 'move', from: 'e4', to: 'd5' });
  g.apply('w', { type: 'poker', kind: 'allin' });
  assert.ok(g.apply('b', { type: 'poker', kind: 'call' }).ok);
  let h = g.hand;
  assert.equal(h.done, false);
  assert.equal(h.runout, true);
  assert.equal(h.board.length, 0);
  assert.equal(h.toAct, null);
  assert.ok(h.hole.w && h.hole.b);
  assert.ok(g.viewFor('w').hand.hole.b, 'both hands are turned up once the cards are on their back');
  t += 900; g.tick(); assert.equal(g.hand.board.length, 0);
  t += 200; g.tick(); assert.equal(g.hand.board.length, 3);           // flop
  t += 500; g.tick(); assert.equal(g.hand.board.length, 4);           // turn
  t += 500; g.tick(); assert.equal(g.hand.board.length, 5);           // river
  assert.equal(g.hand.done, false);                                   // stalls on the full board
  t += 700; g.tick(); assert.equal(g.hand.done, false);
  t += 200; g.tick(); assert.equal(g.hand.done, true);                // now the result
  assert.ok(g.hand.result);
});

test('failed escape from check: the king still gets a move; with no king move it is checkmate', () => {
  const g = new Game({ rng: mulberry(4) });
  g.chess.load('k7/8/8/8/2b5/8/4r2R/4K3 w - - 0 1'); // Re1 is in check from the rook; Rxe2 loses to the bishop's cover but is legal
  assert.ok(g.chess.inCheck());
  assert.ok(g.apply('w', { type: 'move', from: 'h2', to: 'e2' }).ok);
  assert.equal(g.phase, 'poker');
  foldAlways(g, 'w');
  assert.equal(g.phase, 'chess');
  assert.equal(g.chess.get('h2'), undefined);            // the rook that failed is gone
  assert.equal(g.chess.turn(), 'w');                     // still White to move
  assert.equal(g.kingOnly, 'w');
  const v = g.viewFor('w');
  assert.ok(v.legal.length > 0 && v.legal.every((m) => m.from === 'e1'));
  assert.equal(g.apply('w', { type: 'move', from: 'e1', to: 'd1' }).ok, true);
  assert.equal(g.kingOnly, null);
  assert.equal(g.chess.turn(), 'b');
});

test('failed escape from check with the king boxed in is checkmate', () => {
  const g = new Game({ rng: mulberry(4) });
  g.chess.load('4k3/8/8/8/8/3p4/4q3/3QK3 w - - 0 1');
  g.apply('w', { type: 'move', from: 'd1', to: 'e2' });
  foldAlways(g, 'w');
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result, { winner: 'b', reason: 'checkmate' });
});
