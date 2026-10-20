// A simple computer opponent. Not strong, just playable.
//  - Chess: shallow alpha-beta search on material plus a little positional sense. It knows that
//    captures are gambles (a capture only lands with roughly stack-share probability).
//  - Poker: Monte Carlo equity against a random hand, compared with pot odds, plus a little noise.
// Levels: 'easy' (1-ply, noisy) and 'normal' (2-ply, less noisy).

import { Chess } from '../vendor/chess.js';
import { RULES, exchangeStacks } from './rules.js';
import * as P from './poker.js';

const other = P.other;
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// ---------- chess ----------
const CENTER = (sq) => {
  const f = sq.charCodeAt(0) - 97, r = sq.charCodeAt(1) - 49;
  return 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)) / 1; // 0..3
};

function evalWhite(c) {
  let s = 0;
  const b = c.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = b[r][f];
      if (!p) continue;
      const sq = 'abcdefgh'[f] + (8 - r);
      let v = VAL[p.type];
      if (p.type === 'n' || p.type === 'b') v += CENTER(sq) * 6;
      if (p.type === 'p') {
        const adv = p.color === 'w' ? 7 - r : r; // rows advanced (1..6)
        v += adv * 4 + (f >= 2 && f <= 5 ? CENTER(sq) * 2 : 0);
      }
      s += p.color === 'w' ? v : -v;
    }
  }
  return s;
}

const evalSTM = (c) => (c.turn() === 'w' ? 1 : -1) * evalWhite(c);

function orderMoves(moves) {
  return moves.sort((a, b) => (b.captured ? VAL[b.captured] * 10 - VAL[b.piece] : 0) - (a.captured ? VAL[a.captured] * 10 - VAL[a.piece] : 0));
}

function negamax(c, depth, alpha, beta, ply) {
  if (depth === 0) return evalSTM(c);
  const moves = c.moves({ verbose: true });
  if (!moves.length) return c.inCheck() ? -100000 + ply : 0;
  let best = -Infinity;
  for (const m of orderMoves(moves)) {
    c.move(m);
    const s = -negamax(c, depth - 1, -beta, -alpha, ply + 1);
    c.undo();
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Returns { from, to, promotion } for `game` (a Game) where it is `seat`'s turn.
export function chooseMove(game, seat, level = 'normal', rng = Math.random) {
  const c = new Chess(game.chess.fen());
  const depth = level === 'easy' ? 1 : 2;
  const noise = level === 'easy' ? 60 : 15;
  const inCheck = c.inCheck();
  const base = inCheck ? -90000 : evalSTM(c) - 15; // a failed capture wastes the move (and loses the game if it was escaping check)
  const moves = c.moves({ verbose: true }).filter((m) => game.kingOnly !== seat || m.piece === 'k');
  // shuffle so ties are not always broken the same way
  for (let i = moves.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [moves[i], moves[j]] = [moves[j], moves[i]]; }
  let best = null, bestScore = -Infinity;
  for (const m of orderMoves(moves)) {
    c.move(m);
    let s = -negamax(c, depth - 1, -Infinity, Infinity, 1);
    c.undo();
    if (m.captured && m.piece !== 'k') {
      const st = exchangeStacks(m.piece, m.captured);
      const p = st.attacker / (st.attacker + st.defender); // chance the capture lands, at equal poker skill
      s = p * s + (1 - p) * base;
    }
    s += (rng() - 0.5) * 2 * noise;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return { from: best.from, to: best.to, promotion: best.promotion || undefined };
}

// ---------- poker ----------
export function equity(hole, board, samples = 200, rng = Math.random) {
  const used = new Set([...hole, ...board]);
  const rest = [];
  for (let i = 0; i < 52; i++) if (!used.has(i)) rest.push(i);
  const need = 5 - board.length;
  let score = 0;
  for (let n = 0; n < samples; n++) {
    // partial Fisher-Yates for 2 + need cards
    const k = 2 + need;
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rng() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const opp = [rest[0], rest[1]];
    const full = board.concat(rest.slice(2, 2 + need));
    const me = P.evaluate(hole.concat(full)).score;
    const them = P.evaluate(opp.concat(full)).score;
    score += me > them ? 1 : me === them ? 0.5 : 0;
  }
  return score / samples;
}

// Returns an action for Game.apply: { kind, amount? }
export function choosePokerAction(game, seat, level = 'normal', rng = Math.random) {
  const h = game.hand;
  const o = P.options(h, seat);
  const opp = other(seat);
  const eq = equity(h.hole[seat], h.board, level === 'easy' ? 60 : 200, rng);
  const e = eq + (rng() - 0.5) * (level === 'easy' ? 0.2 : 0.07);
  const pot = h.dead + h.committed.w + h.committed.b;
  const toCall = o.callAmount;
  const myStack = h.stacks[seat] + h.bets[seat];
  const effBB = Math.min(myStack, h.stacks[opp] + h.bets[opp]) / h.bb;

  const sized = (frac) => {
    // bets are always whole half-blinds, so every chip on the table is a clean 0.5 BB step
    const to = Math.round((h.bets[opp] + (pot + toCall) * frac) / h.sb) * h.sb;
    return { kind: 'raise', amount: Math.max(o.minRaiseTo, Math.min(o.maxRaiseTo, to)) };
  };

  if (toCall > 0) {
    const potOdds = toCall / (pot + toCall);
    if (o.canRaise && effBB <= 4 && e > 0.58) return { kind: 'allin' };
    if (o.canRaise && e > 0.78) return sized(0.75 + rng() * 0.5);
    if (e > potOdds + 0.04) return { kind: 'call' };
    // cheap bluff-catch: tiny bets are rarely worth folding to
    if (toCall <= h.bb && e > 0.3) return { kind: 'call' };
    return { kind: 'fold' };
  }
  // no bet to face: check or bet
  if (o.canRaise) {
    if (effBB <= 4 && e > 0.55) return { kind: 'allin' };
    if (e > 0.62) return sized(0.5 + rng() * 0.35);
    if (e < 0.4 && rng() < 0.07) return sized(0.5); // occasional bluff
  }
  return { kind: 'check' };
}
