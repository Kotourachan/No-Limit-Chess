// The whole game: chess + the capture -> poker mini-match flow.
// Pure logic. The host (or a local session) owns one Game and feeds it actions;
// each player gets a per-seat view with hidden cards stripped out.
//
// Every capture starts a heads-up mini-match with its own stacks. The capturer has the
// button for every hand of the exchange; hands are played until one side is out
// of chips. If the capturer wins the match the capture stands, otherwise it fails.

import { Chess } from '../vendor/chess.js';
import { RULES, exchangeStacks } from './rules.js';
import * as P from './poker.js';

const other = P.other;
const NAME = { w: 'White', b: 'Black' };
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const bbs = (chips, bb) => (chips / bb).toFixed(chips % bb ? 1 : 0);

export class Game {
  constructor(opts = {}) {
    this.rules = { ...RULES, ...(opts.rules || {}) };
    this.rng = opts.rng;
    this.chess = new Chess();
    this.phase = 'chess'; // 'chess' | 'poker' | 'over'
    this.pending = null;  // the capture being fought over
    this.match = null;    // { capturer, stacks, button, handNo }
    this.hand = null;
    this.lastHand = null;
    this.lastExchange = null;
    this.lastCapture = null; // { square, by, ply }
    this.ply = 0;
    this.captured = { w: [], b: [] }; // pieces each color has lost
    this.result = null;
    this.log = [];
  }

  say(s) {
    this.log.push(s);
    if (this.log.length > 80) this.log.shift();
  }

  apply(seat, action) {
    if (this.phase === 'over') return { ok: false, error: 'Game is over' };
    if (action.type === 'resign') {
      this._end(other(seat), 'resignation');
      return { ok: true };
    }
    if (action.type === 'move') return this._move(seat, action);
    if (action.type === 'poker') return this._poker(seat, action);
    return { ok: false, error: 'Unknown action' };
  }

  _end(winner, reason) {
    this.phase = 'over';
    this.result = { winner, reason };
    this.say(winner === 'draw' ? `Game drawn (${reason})` : `${NAME[winner]} wins by ${reason}`);
  }

  _checkEnd() {
    const c = this.chess;
    if (c.isCheckmate()) this._end(other(c.turn()), 'checkmate');
    else if (c.isGameOver()) this._end('draw', c.isStalemate() ? 'stalemate' : 'draw rule');
  }

  _move(seat, { from, to, promotion }) {
    if (this.phase !== 'chess') return { ok: false, error: 'A poker hand is in progress' };
    if (this.chess.turn() !== seat) return { ok: false, error: 'Not your turn' };
    const cands = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!cands.length) return { ok: false, error: 'Illegal move' };
    const m = cands.find((x) => x.promotion === (promotion || 'q')) || cands[0];
    const R = this.rules;

    if (m.captured) {
      const forced = R.forcedCapturesSkipHand && this.chess.inCheck();
      const kingAuto = R.kingCapturesAutomatic && m.piece === 'k';
      if (forced || kingAuto) {
        this._commit(seat, m);
        this.say(`${NAME[seat]} ${PIECE[m.piece]} takes ${PIECE[m.captured]} on ${m.to} (${kingAuto ? 'king captures are automatic' : 'forced, in check'}, no hand played)`);
        return { ok: true };
      }
      this._startExchange(seat, m);
      return { ok: true };
    }
    this._commit(seat, m);
    return { ok: true };
  }

  _startExchange(seat, m) {
    const R = this.rules;
    const isRecapture = !!(this.lastCapture && this.lastCapture.by !== seat && this.lastCapture.square === m.to && this.lastCapture.ply === this.ply);
    const st = exchangeStacks(m.piece, m.captured, R);
    const stacks = { [seat]: st.attacker, [other(seat)]: st.defender };
    this.pending = {
      from: m.from, to: m.to, promotion: m.promotion, san: m.san, color: seat,
      piece: m.piece, captured: m.captured, isRecapture, startStacks: { ...stacks },
    };
    this.match = { capturer: seat, stacks: { ...stacks }, button: seat, handNo: 1 };
    this.lastHand = null;
    this.say(`${NAME[seat]} ${PIECE[m.piece]} takes ${PIECE[m.captured]} on ${m.to}${isRecapture ? ' (recapture)' : ''}. Mini-match: ${NAME[seat]} ${bbs(st.attacker, R.bb)} BB vs ${NAME[other(seat)]} ${bbs(st.defender, R.bb)} BB`);
    this.phase = 'poker';
    this._dealHand();
  }

  _dealHand() {
    const R = this.rules;
    const mt = this.match;
    this.hand = P.startHand({ stacks: mt.stacks, button: mt.button, initiator: mt.capturer, ante: 0, sb: R.sb, bb: R.bb, rng: this.rng });
    this.hand.log.forEach((l) => this.say(l));
    // A short stack can be all-in from the blinds alone, which finishes the hand immediately.
    if (this.hand.done) this._afterHand();
  }

  _poker(seat, a) {
    if (this.phase !== 'poker') return { ok: false, error: 'No hand in progress' };
    const logStart = this.hand.log.length;
    const r = P.act(this.hand, seat, a);
    if (!r.ok) return r;
    for (const l of this.hand.log.slice(logStart)) this.say(l);
    if (this.hand.done) this._afterHand();
    return { ok: true };
  }

  _afterHand() {
    const h = this.hand;
    const mt = this.match;
    mt.stacks = { ...h.stacks };
    this.lastHand = {
      board: [...h.board], hole: { w: [...h.hole.w], b: [...h.hole.b] }, result: h.result,
      initiator: h.initiator, button: h.button, text: h.log[h.log.length - 1],
    };
    const out = mt.stacks.w === 0 ? 'w' : mt.stacks.b === 0 ? 'b' : null;
    if (!out) {
      mt.handNo++; // the button stays with the capturer for the whole exchange
      this._dealHand();
      return;
    }
    // Mini-match over.
    const p = this.pending;
    const winner = other(out);
    const stands = winner === p.color;
    this.lastExchange = { stands, color: p.color, from: p.from, to: p.to, piece: p.piece, captured: p.captured, winner };
    this.hand = null;
    this.match = null;
    this.pending = null;
    this.phase = 'chess';
    this.say(`${NAME[winner]} wins the exchange`);
    if (stands) {
      this.say('The capture stands');
      this._commit(p.color, p);
    } else {
      this.say(`The capture fails. ${NAME[p.color]}'s move is spent and pieces stay where they were`);
      this._failCapture();
    }
  }

  _commit(seat, m) {
    const mv = this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    this.ply++;
    this.lastCapture = mv.captured ? { square: mv.to, by: seat, ply: this.ply } : null;
    if (mv.captured) this.captured[other(seat)].push(mv.captured);
    this._checkEnd();
  }

  _failCapture() {
    const parts = this.chess.fen().split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    if (parts[1] === 'w') parts[5] = String(Number(parts[5]) + 1);
    this.chess.load(parts.join(' '));
    this.ply++;
    this.lastCapture = null;
    this._checkEnd();
  }

  // ---- views ----
  legalMoves() {
    return this.chess.moves({ verbose: true }).map((m) => ({ from: m.from, to: m.to, capture: !!m.captured, promotion: m.promotion || null }));
  }

  viewFor(seat, { god = false } = {}) {
    const h = this.hand;
    let hand = null;
    if (h) {
      const rev = (s) => god || s === seat;
      hand = {
        street: h.street, board: [...h.board], pot: h.dead + h.committed.w + h.committed.b,
        bets: { ...h.bets }, stacks: { ...h.stacks }, toAct: h.toAct, button: h.button, initiator: h.initiator,
        sb: h.sb, bb: h.bb, handNo: this.match.handNo,
        hole: { w: rev('w') ? [...h.hole.w] : null, b: rev('b') ? [...h.hole.b] : null },
        options: h.toAct ? P.options(h, h.toAct) : null,
      };
    }
    let lastHand = null;
    if (this.lastHand) {
      const lh = this.lastHand;
      const show = (s) => god || lh.result.reveal[s] || s === seat;
      lastHand = {
        board: lh.board, result: { winner: lh.result.winner, reason: lh.result.reason, pot: lh.result.pot, names: lh.result.names },
        hole: { w: show('w') ? lh.hole.w : null, b: show('b') ? lh.hole.b : null },
        initiator: lh.initiator, button: lh.button, text: lh.text,
      };
    }
    return {
      you: seat,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      inCheck: this.chess.inCheck(),
      phase: this.phase,
      captured: { w: [...this.captured.w], b: [...this.captured.b] },
      legal: this.phase === 'chess' && this.chess.turn() === seat ? this.legalMoves() : [],
      pending: this.pending ? { ...this.pending } : null,
      hand, lastHand,
      lastExchange: this.lastExchange,
      result: this.result,
      log: this.log.slice(-40),
      bb: this.rules.bb,
    };
  }
}
