// Heads-up no-limit hold'em hand engine. Pure logic, no UI, no networking.
// Seats are 'w' and 'b' (they match the chess colors).

export const other = (s) => (s === 'w' ? 'b' : 'w');
export const RANKS = '23456789TJQKA';
export const SUITS = '♠♥♦♣';
export const SUIT_LETTERS = 'shdc';
const SEAT_NAME = { w: 'White', b: 'Black' };
// Log lines speak in big blinds, like the rest of the screen.
const inBB = (h, chips) => `${Math.round((chips / h.bb) * 100) / 100} BB`;

export const cardStr = (id) => RANKS[id % 13] + SUITS[Math.floor(id / 13)];
export const cardKey = (id) => RANKS[id % 13] + SUIT_LETTERS[Math.floor(id / 13)]; // e.g. "As"

function randInt(n, rng) {
  if (rng) return Math.floor(rng() * n);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const a = new Uint32Array(1);
    const limit = Math.floor(0xffffffff / n) * n;
    do { globalThis.crypto.getRandomValues(a); } while (a[0] >= limit);
    return a[0] % n;
  }
  return Math.floor(Math.random() * n);
}

export function shuffledDeck(rng) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randInt(i + 1, rng);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------- hand evaluation ----------
export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

function rank5(cards) {
  const rs = cards.map((id) => 2 + (id % 13)).sort((a, b) => b - a);
  const flush = cards.every((id) => Math.floor(id / 13) === Math.floor(cards[0] / 13));
  let straightHigh = 0;
  if (new Set(rs).size === 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 14 && rs[1] === 5) straightHigh = 5; // wheel
  }
  const counts = {};
  for (const r of rs) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let cat, tb;
  if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
  else if (groups[0][0] === 4) { cat = 7; tb = groups.map((g) => g[1]); }
  else if (groups[0][0] === 3 && groups[1][0] === 2) { cat = 6; tb = groups.map((g) => g[1]); }
  else if (flush) { cat = 5; tb = rs; }
  else if (straightHigh) { cat = 4; tb = [straightHigh]; }
  else if (groups[0][0] === 3) { cat = 3; tb = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2 && groups[1][0] === 2) { cat = 2; tb = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2) { cat = 1; tb = groups.map((g) => g[1]); }
  else { cat = 0; tb = rs; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (tb[i] || 0);
  return s;
}

// Best 5-card hand out of up to 7 cards. Returns { score, name }.
export function evaluate(ids) {
  let best = -1;
  const n = ids.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = rank5([ids[a], ids[b], ids[c], ids[d], ids[e]]);
            if (s > best) best = s;
          }
  const cat = Math.floor(best / Math.pow(15, 5));
  return { score: best, name: HAND_NAMES[cat] };
}

// ---------- hand state machine ----------
function post(h, seat, amt) {
  const a = Math.min(amt, h.stacks[seat]);
  h.stacks[seat] -= a;
  h.bets[seat] += a;
  h.committed[seat] += a;
  return a;
}

export function startHand({ stacks, button, initiator, ante = 0, sb, bb, rng }) {
  const deck = shuffledDeck(rng);
  const nb = other(button);
  const h = {
    stacks: { w: stacks.w, b: stacks.b },
    startStacks: { w: stacks.w, b: stacks.b },
    button, initiator, sb, bb,
    deck,
    hole: { [button]: [deck.pop(), deck.pop()], [nb]: [deck.pop(), deck.pop()] },
    board: [],
    bets: { w: 0, b: 0 },
    committed: { w: 0, b: 0 },
    dead: 0,
    street: 'preflop',
    acted: { w: false, b: false },
    currentBet: 0,
    lastRaise: bb,
    toAct: button,
    acts: { w: null, b: null }, // last action of each seat, shown at the table
    lastActor: null,
    sweep: null,    // bets collected into the pot when a street ended: { from, bets }
    endBets: null,  // bets on the table when the hand ended (before any refund)
    done: false,
    result: null,
    log: [],
  };
  if (ante > 0) {
    const a = Math.min(ante, h.stacks[initiator]);
    h.stacks[initiator] -= a;
    h.dead += a;
    if (a > 0) h.log.push(`${SEAT_NAME[initiator]} posts a dead ante of ${inBB(h, a)}`);
  }
  post(h, button, sb);
  post(h, nb, bb);
  h.currentBet = Math.max(h.bets.w, h.bets.b);
  h.log.push(`${SEAT_NAME[button]} is the dealer (small blind ${inBB(h, h.bets[button])}), ${SEAT_NAME[nb]} posts the big blind ${inBB(h, h.bets[nb])}`);
  if (roundComplete(h)) endRound(h);
  return h;
}

function roundComplete(h) {
  const eq = h.bets.w === h.bets.b;
  const lower = eq ? null : h.bets.w < h.bets.b ? 'w' : 'b';
  const anyAllIn = h.stacks.w === 0 || h.stacks.b === 0;
  if (anyAllIn && (eq || h.stacks[lower] === 0)) return true;
  return h.acted.w && h.acted.b && eq;
}

function dealTo(h, n) {
  while (h.board.length < n) h.board.push(h.deck.pop());
}

function endRound(h) {
  const allIn = h.stacks.w === 0 || h.stacks.b === 0;
  if (h.street === 'river' || allIn) {
    dealTo(h, 5);
    h.street = 'showdown';
    return finish(h, {});
  }
  h.sweep = { from: h.street, bets: { w: h.bets.w, b: h.bets.b } };
  h.street = h.street === 'preflop' ? 'flop' : h.street === 'flop' ? 'turn' : 'river';
  dealTo(h, h.street === 'flop' ? 3 : h.street === 'turn' ? 4 : 5);
  h.bets = { w: 0, b: 0 };
  h.acted = { w: false, b: false };
  h.currentBet = 0;
  h.lastRaise = h.bb;
  h.toAct = other(h.button);
  h.log.push(`-- ${h.street}: ${h.board.map(cardStr).join(' ')}`);
}

function finish(h, { folder }) {
  h.endBets = { w: h.bets.w, b: h.bets.b };
  // Return any uncalled excess to whoever bet it.
  if (h.committed.w !== h.committed.b) {
    const big = h.committed.w > h.committed.b ? 'w' : 'b';
    const ex = Math.abs(h.committed.w - h.committed.b);
    h.stacks[big] += ex;
    h.committed[big] -= ex;
  }
  const pot = h.dead + h.committed.w + h.committed.b;
  const result = { pot, reason: folder ? 'fold' : 'showdown', reveal: { w: false, b: false }, names: { w: null, b: null } };
  if (folder) {
    result.winner = other(folder);
  } else {
    const sw = evaluate([...h.hole.w, ...h.board]);
    const sb_ = evaluate([...h.hole.b, ...h.board]);
    result.names = { w: sw.name, b: sb_.name };
    result.winner = sw.score > sb_.score ? 'w' : sb_.score > sw.score ? 'b' : 'tie';
    // Showdown rule: the initiator must show. The other player may muck if they lose.
    const nonInit = other(h.initiator);
    result.reveal[h.initiator] = true;
    result.reveal[nonInit] = result.winner === nonInit || result.winner === 'tie';
  }
  if (result.winner === 'tie') {
    const half = Math.floor(pot / 2);
    h.stacks.w += half;
    h.stacks.b += half;
    h.stacks[h.button] += pot - half * 2;
  } else {
    h.stacks[result.winner] += pot;
  }
  h.done = true;
  h.toAct = null;
  h.result = result;
  if (folder) h.log.push(`${SEAT_NAME[folder]} folds. ${SEAT_NAME[result.winner]} wins ${inBB(h, pot)}`);
  else if (result.winner === 'tie') h.log.push(`Split pot of ${inBB(h, pot)} (${result.names.w})`);
  else h.log.push(`${SEAT_NAME[result.winner]} wins ${inBB(h, pot)} with ${result.names[result.winner]}`);
}

export function options(h, seat) {
  const opp = other(seat);
  const toCall = Math.max(0, h.currentBet - h.bets[seat]);
  const callAmount = Math.min(toCall, h.stacks[seat]);
  // Never allow bets bigger than the opponent can match.
  const maxTo = Math.min(h.bets[seat] + h.stacks[seat], h.bets[opp] + h.stacks[opp]);
  const minTo = Math.min(maxTo, h.currentBet + h.lastRaise);
  return {
    canCheck: toCall === 0,
    callAmount,
    minRaiseTo: minTo,
    maxRaiseTo: maxTo,
    canRaise: maxTo > h.currentBet && h.stacks[seat] > toCall,
    isAllInMax: maxTo === h.bets[seat] + h.stacks[seat],
  };
}

// action: { kind: 'fold'|'check'|'call'|'raise'|'allin', amount? }
export function act(h, seat, action) {
  if (h.done) return { ok: false, error: 'Hand is over' };
  if (h.toAct !== seat) return { ok: false, error: 'Not your turn' };
  const opp = other(seat);
  const o = options(h, seat);
  const who = SEAT_NAME[seat];
  let kind = action.kind;
  if (kind === 'call' && o.canCheck) kind = 'check';
  if (kind === 'allin') kind = o.canRaise ? 'raise' : 'call';
  if (kind === 'allin') kind = 'call';

  if (kind === 'fold') {
    h.acts[seat] = { kind: 'fold', street: h.street };
    h.lastActor = seat;
    h.log.push(`${who} folds`);
    finish(h, { folder: seat });
    return { ok: true };
  }
  if (kind === 'check') {
    if (!o.canCheck) return { ok: false, error: "Can't check, there is a bet to call" };
    h.acted[seat] = true;
    h.acts[seat] = { kind: 'check', street: h.street };
    h.log.push(`${who} checks`);
  } else if (kind === 'call') {
    const a = Math.min(o.callAmount, h.stacks[seat]);
    h.stacks[seat] -= a; h.bets[seat] += a; h.committed[seat] += a;
    h.acted[seat] = true;
    h.acts[seat] = { kind: 'call', amount: a, allIn: h.stacks[seat] === 0, street: h.street };
    h.log.push(`${who} calls ${inBB(h, a)}${h.stacks[seat] === 0 ? ' (all-in)' : ''}`);
  } else if (kind === 'raise') {
    if (!o.canRaise) return { ok: false, error: "Can't raise" };
    let to = Math.floor(Number(action.amount));
    if (action.kind === 'allin' || !Number.isFinite(to)) to = o.maxRaiseTo;
    to = Math.max(o.minRaiseTo, Math.min(o.maxRaiseTo, to));
    const pay = to - h.bets[seat];
    h.stacks[seat] -= pay; h.bets[seat] += pay; h.committed[seat] += pay;
    if (to - h.currentBet >= h.lastRaise) h.lastRaise = to - h.currentBet;
    const verb = h.currentBet === 0 ? 'bets' : 'raises to';
    h.acts[seat] = { kind: verb === 'bets' ? 'bet' : 'raise', to, allIn: h.stacks[seat] === 0, street: h.street };
    h.currentBet = to;
    h.acted[seat] = true;
    h.acted[opp] = false;
    h.log.push(`${who} ${verb} ${inBB(h, to)}${h.stacks[seat] === 0 ? ' (all-in)' : ''}`);
  } else {
    return { ok: false, error: 'Unknown action' };
  }
  h.lastActor = seat;
  if (roundComplete(h)) endRound(h);
  else h.toAct = opp;
  return { ok: true };
}
