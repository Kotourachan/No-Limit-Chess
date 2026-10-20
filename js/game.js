// The whole game: chess + the capture -> poker mini-match flow.
// Pure logic. The host (or a local session) owns one Game and feeds it actions;
// each player gets a per-seat view with hidden cards stripped out.
//
// Every capture starts a heads-up mini-match with its own stacks. The capturer has the
// button for every hand of the exchange; hands are played until one side is out of chips.
// If the capturer wins the mini-match the capture stands. If they lose, the capturing
// piece is lost and the move is spent.
//
// Options (all optional):
//   manualAdvance  keep a finished hand on the table for pauseMs before the next hand / the
//                  board comes back (the host calls tick() regularly). Off: instant.
//   actionMs       per-decision clock in ms (0 = no clock).
//   overtimeMs     extra time bank per player, refilled at the start of every exchange. It is
//                  used once the decision clock runs out. Out of both: the player checks if
//                  that is free, otherwise folds.
//   captureMs      the arrow + CAPTURE banner on the board, before the pop-up.
//   introMs        the capture pop-up. Nobody can act during it (first hand of an exchange).
//   dealMs         deal animation and blinds at the start of every hand. Nobody can act.
//   bufferMs       pause after every decision so the move and the chips can be seen. The
//                  next player's clock starts when it ends.

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
    this.manual = !!opts.manualAdvance;
    this.actionMs = opts.actionMs || 0;
    this.overtimeMs = opts.overtimeMs || 0;
    this.pauseMs = opts.pauseMs == null ? 3200 : opts.pauseMs;
    this.captureMs = opts.captureMs || 0;
    this.introMs = opts.introMs || 0;
    this.dealMs = opts.dealMs || 0;
    this.bufferMs = opts.bufferMs || 0;
    this.runoutFirstMs = opts.runoutFirstMs || 0;   // all-in: pause before the first street is dealt
    this.runoutStepMs = opts.runoutStepMs || 0;     // all-in: time between streets (0 = deal everything at once)
    this.runoutStallMs = opts.runoutStallMs || 0;   // all-in: pause on the full board before the result
    this.runoutAt = null;
    this.now = opts.now || (() => Date.now());
    this.chess = new Chess();
    this.phase = 'chess'; // 'chess' | 'poker' | 'over'
    this.kingOnly = null; // set after a failed capture while in check: that side must now move its king
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
    this.deadline = null;   // when the player to act runs out of time
    this.holdUntil = null;  // nobody may act before this (animations)
    this.clockMode = 'main'; // 'main' decision clock or 'ot' overtime
    this.otStart = null;
    this.otTotal = 0;
    this.ot = { w: this.overtimeMs, b: this.overtimeMs }; // overtime banks of the current exchange
    this.advanceAt = null;  // when a finished hand moves on (manualAdvance only)
    this.exchangeNo = 0;
    this.handSeq = 0;
    this.lastMove = null;   // { from, to, lost? } for move animations
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
    this.deadline = null;
    this.advanceAt = null;
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
    if (this.kingOnly === seat && cands[0].piece !== 'k') return { ok: false, error: 'You are still in check: the king has to move' };
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
    this.exchangeNo++;
    this.ot = { w: this.overtimeMs, b: this.overtimeMs };
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
    this.hand = P.startHand({ stacks: mt.stacks, button: mt.button, initiator: mt.capturer, ante: 0, sb: R.sb, bb: R.bb, rng: this.rng, staged: this.runoutStepMs > 0 });
    this.hand.id = ++this.handSeq;
    this.hand.log.forEach((l) => this.say(l));
    // A short stack can be all-in from the blinds alone, which finishes the hand immediately.
    if (this.hand.done) { this.holdUntil = null; this._afterHand(); return; }
    this._hold(this.dealMs + (mt.handNo === 1 ? this.captureMs + this.introMs : 0));
    this._armTimer();
    if (this.hand.runout) this._startRunout(this.holdRemaining());   // all in from the blinds
  }

  // Both players are all in: the rest of the board comes out a street at a time.
  _startRunout(extra = 0) {
    this.deadline = null;
    this.runoutAt = this.now() + extra + this.runoutFirstMs;
  }

  _hold(ms) { this.holdUntil = ms > 0 ? this.now() + ms : null; }

  holdRemaining() { return this.holdUntil ? Math.max(0, this.holdUntil - this.now()) : 0; }

  // The decision clock for whoever is to act starts when the current hold ends.
  _armTimer() {
    this.clockMode = 'main';
    this.otStart = null;
    if (!this.actionMs || !this.hand || this.hand.done || this.phase !== 'poker') { this.deadline = null; return; }
    const t = this.now();
    this.deadline = Math.max(t, this.holdUntil || 0) + this.actionMs;
  }

  _poker(seat, a, { force = false } = {}) {
    if (this.phase !== 'poker' || !this.hand) return { ok: false, error: 'No hand in progress' };
    if (!force && this.holdUntil && this.now() < this.holdUntil) return { ok: false, error: 'Hold on, the table is still showing the last move' };
    const t = this.now();
    const logStart = this.hand.log.length;
    const r = P.act(this.hand, seat, a);
    if (!r.ok) return r;
    // time spent in overtime comes out of that player's bank
    if (this.clockMode === 'ot' && this.otStart != null) this.ot[seat] = Math.max(0, this.ot[seat] - Math.max(0, t - this.otStart));
    for (const l of this.hand.log.slice(logStart)) this.say(l);
    if (this.hand.done) this._afterHand();
    else if (this.hand.runout) { this.holdUntil = null; this._startRunout(this.bufferMs); }
    else { this._hold(this.bufferMs); this._armTimer(); }
    return { ok: true };
  }

  // The hand just finished. In manual mode it stays on the table for a moment.
  _afterHand() {
    const h = this.hand;
    const mt = this.match;
    const p = this.pending;
    mt.stacks = { ...h.stacks };
    this.lastHand = {
      board: [...h.board], hole: { w: [...h.hole.w], b: [...h.hole.b] }, result: h.result,
      initiator: h.initiator, button: h.button, text: h.log[h.log.length - 1],
    };
    this.deadline = null;
    this.holdUntil = null;
    this.runoutAt = null;
    if (this.manual) {
      const out = this._busted();
      h.matchOver = !!out;
      if (out) { h.matchWinner = other(out); h.matchStands = other(out) === p.color; }
      this.advanceAt = this.now() + this.pauseMs;
      return;
    }
    this._finishHand();
  }

  _busted() {
    const s = this.match.stacks;
    return s.w === 0 ? 'w' : s.b === 0 ? 'b' : null;
  }

  // Moves on from a finished hand: next hand, or resolve the exchange.
  advance() {
    if (this.phase !== 'poker' || !this.hand || !this.hand.done) return { ok: false, error: 'Nothing to advance' };
    this.advanceAt = null;
    this._finishHand();
    return { ok: true };
  }

  _finishHand() {
    const mt = this.match;
    const out = this._busted();
    if (!out) {
      mt.handNo++; // the button stays with the capturer for the whole exchange
      this._dealHand();
      return;
    }
    const p = this.pending;
    const winner = other(out);
    const stands = winner === p.color;
    this.lastExchange = { stands, color: p.color, from: p.from, to: p.to, piece: p.piece, captured: p.captured, winner, no: this.exchangeNo };
    this.hand = null;
    this.match = null;
    this.pending = null;
    this.phase = 'chess';
    this.deadline = null;
    this.advanceAt = null;
    this.say(`${NAME[winner]} wins the exchange`);
    if (stands) {
      this.say('The capture stands');
      this._commit(p.color, p);
    } else {
      this.say(`The capture fails. ${NAME[p.color]}'s ${PIECE[p.piece]} is lost`);
      this._loseCapturer(p);
    }
  }

  // Called by the host a few times a second. Returns true if the game state changed.
  tick() {
    if (this.phase === 'over') return false;
    const t = this.now();
    let changed = false;
    if (this.holdUntil && t >= this.holdUntil) { this.holdUntil = null; changed = true; }
    if (this.runoutAt && t >= this.runoutAt && this.hand && this.hand.runout && !this.hand.done) {
      const h = this.hand, logStart = h.log.length;
      P.runoutStep(h);
      for (const l of h.log.slice(logStart)) this.say(l);
      if (h.done) this._afterHand();
      else this.runoutAt = t + (h.board.length >= 5 ? this.runoutStallMs : this.runoutStepMs);
      return true;
    }
    if (this.advanceAt && t >= this.advanceAt) return this.advance().ok || changed;
    if (this.deadline && t >= this.deadline && this.hand && !this.hand.done) {
      const seat = this.hand.toAct;
      if (this.clockMode === 'main' && this.ot[seat] > 0) {
        this.clockMode = 'ot';
        this.otStart = this.deadline;
        this.otTotal = this.ot[seat];
        this.deadline = this.otStart + this.otTotal;
        this.say(`${NAME[seat]} is in overtime (${Math.round(this.otTotal / 1000)}s bank)`);
        return true;
      }
      return this.timeout().ok || changed;
    }
    return changed;
  }

  // The player to act ran out of time (and overtime): check if free, otherwise fold.
  timeout() {
    if (this.phase !== 'poker' || !this.hand || this.hand.done) return { ok: false, error: 'No decision pending' };
    const seat = this.hand.toAct;
    const o = P.options(this.hand, seat);
    this.say(`${NAME[seat]} ran out of time`);
    this.ot[seat] = 0;
    return this._poker(seat, { kind: o.canCheck ? 'check' : 'fold' }, { force: true });
  }

  _commit(seat, m) {
    this.kingOnly = null;
    const mv = this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    this.ply++;
    this.lastMove = { from: mv.from, to: mv.to };
    this.lastCapture = mv.captured ? { square: mv.to, by: seat, ply: this.ply } : null;
    if (mv.captured) this.captured[other(seat)].push(mv.captured);
    this._checkEnd();
  }

  // A failed capture: the capturing piece is removed from the board, the defender stays put,
  // and the turn passes.
  _loseCapturer(p) {
    const c = this.chess;
    const opp = other(p.color);
    const wasInCheck = c.inCheck();
    c.remove(p.from);
    this.captured[p.color].push(p.piece);
    const parts = c.fen().split(' ');
    // Escaping check with a piece that lost the exchange: the check stands, but the king still gets a move.
    parts[1] = wasInCheck ? p.color : opp;
    parts[3] = '-';
    if (!wasInCheck && opp === 'w') parts[5] = String(Number(parts[5]) + 1);
    c.load(parts.join(' '), { skipValidation: true });
    this.ply++;
    this.lastMove = { from: p.from, to: p.to, lost: true };
    this.lastCapture = null;
    if (wasInCheck) {
      const kingMoves = c.moves({ verbose: true }).filter((m) => m.piece === 'k');
      if (!kingMoves.length) {
        this.say(`${NAME[p.color]} lost the exchange while in check and the king cannot move: checkmate`);
        this._end(opp, 'checkmate');
        return;
      }
      this.kingOnly = p.color;
      this.say(`${NAME[p.color]} is still in check: the king must move`);
      return;
    }
    // If that piece was shielding its own king (a pinned piece that took its pinner), the
    // king is now en prise on the opponent's move.
    if (this._kingAttacked(p.color)) {
      this.say(`${NAME[p.color]}'s king is exposed and falls`);
      this._end(opp, 'king exposed');
      return;
    }
    this._checkEnd();
  }

  _kingAttacked(color) {
    const board = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const pc = board[r][f];
        if (pc && pc.type === 'k' && pc.color === color) return this.chess.isAttacked('abcdefgh'[f] + (8 - r), other(color));
      }
    }
    return false;
  }

  // ---- views ----
  _overtimeView() {
    const ot = { w: this.ot.w, b: this.ot.b };
    const seat = this.hand && !this.hand.done ? this.hand.toAct : null;
    if (this.clockMode === 'ot' && seat && this.deadline) ot[seat] = Math.max(0, this.deadline - this.now());
    return ot;
  }

  legalMoves() {
    const kingOnly = this.kingOnly === this.chess.turn();
    return this.chess.moves({ verbose: true }).filter((m) => !kingOnly || m.piece === 'k').map((m) => ({ from: m.from, to: m.to, capture: !!m.captured, promotion: m.promotion || null }));
  }

  viewFor(seat, { god = false } = {}) {
    const h = this.hand;
    let hand = null;
    if (h) {
      const done = h.done;
      const rev = (s) => god || s === seat || h.runout || (done && h.result.reveal[s]);
      hand = {
        id: h.id, handNo: this.match ? this.match.handNo : 1,
        street: h.street, board: [...h.board],
        pot: done ? h.result.pot : h.dead + h.committed.w + h.committed.b,
        bets: done ? { w: 0, b: 0 } : { ...h.bets },
        stacks: { ...h.stacks }, toAct: h.toAct, button: h.button, initiator: h.initiator,
        sb: h.sb, bb: h.bb,
        hole: { w: rev('w') ? [...h.hole.w] : null, b: rev('b') ? [...h.hole.b] : null },
        options: h.toAct && !done ? P.options(h, h.toAct) : null,
        acts: { w: h.acts.w, b: h.acts.b },
        lastActor: h.lastActor,
        runout: !!h.runout, sweepNo: h.sweepNo,
        sweep: h.sweep ? { from: h.sweep.from, bets: { ...h.sweep.bets } } : null,
        endBets: done && h.endBets ? { ...h.endBets } : null,
        done,
        result: done ? { winner: h.result.winner, reason: h.result.reason, pot: h.result.pot, names: h.result.names } : null,
        matchOver: !!h.matchOver, matchWinner: h.matchWinner || null, matchStands: !!h.matchStands,
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
      kingOnly: this.kingOnly || null,
      phase: this.phase,
      captured: { w: [...this.captured.w], b: [...this.captured.b] },
      legal: this.phase === 'chess' && this.chess.turn() === seat ? this.legalMoves() : [],
      pending: this.pending ? { ...this.pending } : null,
      hand, lastHand,
      lastExchange: this.lastExchange,
      exchangeNo: this.exchangeNo,
      lastMove: this.lastMove,
      ply: this.ply,
      result: this.result,
      actionMs: this.deadline ? Math.max(0, this.deadline - this.now()) : 0,
      actionTotal: this.clockMode === 'ot' ? this.otTotal : this.actionMs,
      clockMode: this.clockMode,
      overtime: this._overtimeView(),
      overtimeTotal: this.overtimeMs,
      holdMs: this.holdRemaining(),
      captureMs: this.captureMs,
      introMs: this.introMs,
      log: this.log.slice(-40),
      bb: this.rules.bb,
    };
  }
}
