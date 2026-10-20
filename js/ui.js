// Placeholder UI. Everything visual goes through skin.js so art can be dropped in later.
// Screens: lobby, ai lobby, waiting, game (chess board), table (poker exchange).
// When a capture starts, a pop-up shows both starting stacks, then the oval table appears.
// On the table one BB is one chip: stacks are piles, bets sit on the felt, and chips fly
// between piles, bets, the pot and the winner whenever something changes.
import { pieceEl, cardEl, emptyCardEl, squareBg } from './skin.js';
import { RULES } from './rules.js';

const $ = (id) => document.getElementById(id);
const other = (s) => (s === 'w' ? 'b' : 'w');
const NAME = { w: 'White', b: 'Black' };
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SEATS = ['w', 'b'];

// Chip amounts are shown in big blinds everywhere, so stacks, bets and pot always agree.
const fmt = (chips, bb) => String(Math.round((chips / bb) * 100) / 100);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

function parseFen(fen) {
  const rows = fen.split(' ')[0].split('/');
  const out = {};
  rows.forEach((row, ri) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else {
        const sq = 'abcdefgh'[f] + (8 - ri);
        out[sq] = { color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() };
        f++;
      }
    }
  });
  return out;
}

// ---------- chips ----------
const CHIP_COLS = 5;                 // chips per column in a pile
const LEG_MS = 620, STAGGER_MS = 70; // flight time of one hop, delay between chips of one flight

const reducedMotion = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
};

// One chip per BB. A part of a BB (a 0.5 BB blind) is one small chip.
function chipCount(chips, bb) {
  if (chips <= 0) return { full: 0, n: 0 };
  const full = Math.floor(chips / bb + 1e-9);
  const part = chips - full * bb > 1e-9 ? 1 : 0;
  return { full, n: full + part };
}

// A pile of chips in columns of five. Chips from index `from` on are new: they fade in after `delay` ms,
// when the flying chips land.
function pileEl(chips, bb, { from = null, delay = 0, small = false } = {}) {
  const { full, n } = chipCount(chips, bb);
  const wrap = h('div', { class: 'pile' + (small ? ' small' : '') + (n ? '' : ' empty') });
  let col = null;
  for (let i = 0; i < n; i++) {
    if (i % CHIP_COLS === 0) { col = h('div', { class: 'col' }); wrap.append(col); }
    const c = h('span', { class: 'chip ' + (i < full ? 'full' : 'half') });
    if (from != null && i >= from) { c.classList.add('arriving'); c.style.animationDelay = Math.round(delay) + 'ms'; }
    col.append(c);
  }
  return wrap;
}

// Chips travelling through the elements in `legs` (e.g. [pile, bet spot]). Purely decorative: the
// real chips already sit where they belong and fade in when the flying ones land.
function flyChips(legs, nChips, { delay = 0 } = {}) {
  const layer = $('fx');
  if (!layer || reducedMotion() || nChips <= 0 || legs.some((l) => !l)) return;
  const pts = legs.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const frames = [{ t: 0, p: pts[0] }];
  let t = 0;
  for (let k = 1; k < pts.length; k++) {
    t += LEG_MS; frames.push({ t, p: pts[k] });
    if (k < pts.length - 1) { t += 160; frames.push({ t, p: pts[k] }); }
  }
  const total = t;
  for (let i = 0; i < Math.min(nChips, 12); i++) {
    const c = h('span', { class: 'chip full fly' });
    c.style.left = pts[0].x - 11 + 'px';
    c.style.top = pts[0].y - 11 + 'px';
    layer.append(c);
    if (typeof c.animate !== 'function') { c.remove(); continue; }
    const jx = (Math.random() - 0.5) * 12, jy = (Math.random() - 0.5) * 8;
    const move = (p, k) => `translate(${p.x - pts[0].x + (k ? jx : 0)}px, ${p.y - pts[0].y + (k ? jy : 0)}px)`;
    const kf = [{ offset: 0, transform: move(pts[0], 0), opacity: 0 }, { offset: 0.03, transform: move(pts[0], 0), opacity: 1, easing: 'ease-in-out' }];
    frames.forEach((fr, k) => { if (k > 0) kf.push({ offset: fr.t / total - (k === frames.length - 1 ? 0.04 : 0), transform: move(fr.p, k), opacity: 1, easing: 'ease-in-out' }); });
    kf.push({ offset: 1, transform: move(frames[frames.length - 1].p, 1), opacity: 0 });
    const d = delay + i * STAGGER_MS;
    const anim = c.animate(kf, { duration: total, delay: d, fill: 'both' });
    const done = () => c.remove();
    anim.onfinish = done;
    setTimeout(done, d + total + 400);
  }
}

export function createUI(cb) {
  let selected = null;
  let lastView = null;
  let lastMeta = {};
  let toastTimer = null;
  let seenExchange;                  // last exchange number announced (undefined until the first update)
  let lastPly;                       // last chess ply drawn, to animate only new moves
  const blankPrev = () => ({ id: null, acts: { w: '', b: '' }, bets: { w: 0, b: 0 }, stacks: null, pot: 0, street: 'preflop', doneShown: null });
  let prev = blankPrev();            // what the table showed last time, so only changes animate
  let clock = null;                  // { end, total, mode } for the visible countdown
  let introFor = 0, introUntil = 0, arrowUntil = 0, introTimer = null, introTimer2 = null, introBuilt = 0, skippedFor = 0, arrowFor = 0;

  const screens = ['lobby', 'waiting', 'game', 'ai', 'table'];
  function show(name) { for (const s of screens) $(s).hidden = s !== name; }

  // ---------- wiring ----------
  $('btn-create').onclick = () => cb.onCreate();
  $('btn-join').onclick = () => cb.onJoin($('join-code').value);
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') cb.onJoin($('join-code').value); });
  $('btn-local').onclick = () => cb.onLocal();
  $('btn-ai').onclick = () => show('ai');
  $('btn-ai-back').onclick = () => show('lobby');
  $('btn-ai-start').onclick = () => cb.onAi({
    color: document.querySelector('input[name=aicolor]:checked').value,
    level: document.querySelector('input[name=ailevel]:checked').value,
  });
  $('btn-cancel').onclick = () => cb.onLeave();
  $('btn-leave').onclick = () => cb.onLeave();
  $('btn-leave2').onclick = () => cb.onLeave();
  $('btn-leave-t').onclick = () => cb.onLeave();
  const resign = () => { if (confirm('Resign this game?')) cb.onAction({ type: 'resign' }); };
  $('btn-resign').onclick = resign;
  $('btn-resign-t').onclick = resign;
  $('btn-rematch').onclick = () => cb.onRematch();
  $('btn-copy').onclick = async () => {
    const url = $('share-link').value;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { $('share-link').select(); }
  };

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4000);
  }

  // The clock under the player whose turn it is (decision clock, then the overtime bank).
  setInterval(() => {
    const fill = $('t-fill');
    if (!clock || !fill) return;
    const left = Math.max(0, clock.end - Date.now());
    fill.style.width = Math.min(100, (left / clock.total) * 100) + '%';
    const sec = $('t-sec');
    if (sec) sec.textContent = (clock.mode === 'ot' ? 'Overtime ' : '') + Math.min(Math.ceil(clock.total / 1000), Math.ceil(left / 1000)) + 's';
    fill.parentElement.classList.toggle('low', left < 3000);
    fill.parentElement.classList.toggle('ot', clock.mode === 'ot');
  }, 100);

  // ---------- chess board ----------
  function renderBoard(v, orientation) {
    const board = $('board');
    board.innerHTML = '';
    const pieces = parseFen(v.fen);
    const files = 'abcdefgh';
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    const fl = orientation === 'b' ? [...files].reverse() : [...files];
    const rl = orientation === 'b' ? [...ranks].reverse() : ranks;
    const myTurn = v.phase === 'chess' && v.turn === v.you && !v.result;
    const targets = new Map();
    if (selected) for (const m of v.legal) if (m.from === selected) targets.set(m.to, m);
    const hl = new Set();
    const pend = new Set();
    if (v.pending) { pend.add(v.pending.from); pend.add(v.pending.to); }
    else if (v.lastMove) { hl.add(v.lastMove.from); if (v.lastMove.to) hl.add(v.lastMove.to); }

    // animate only a move we have not drawn yet
    const fresh = lastPly !== undefined && v.ply !== lastPly && v.lastMove;
    const col = (sq) => (orientation === 'b' ? 7 - files.indexOf(sq[0]) : files.indexOf(sq[0]));
    const row = (sq) => (orientation === 'b' ? Number(sq[1]) - 1 : 8 - Number(sq[1]));

    for (const r of rl) {
      for (const f of fl) {
        const sq = f + r;
        const light = (files.indexOf(f) + r) % 2 === 1;
        const cell = h('div', { class: 'sq ' + (light ? 'light' : 'dark'), 'data-sq': sq });
        const bg = squareBg(light);
        if (bg) cell.style.backgroundImage = bg;
        if (hl.has(sq)) cell.classList.add('lastmove');
        if (pend.has(sq)) cell.classList.add('pending');
        if (selected === sq) cell.classList.add('selected');
        const p = pieces[sq];
        if (p) {
          const pe = pieceEl(p.color, p.type);
          if (fresh && !v.lastMove.lost && sq === v.lastMove.to) {
            pe.classList.add('slide');
            pe.style.setProperty('--dx', col(v.lastMove.from) - col(sq));
            pe.style.setProperty('--dy', row(v.lastMove.from) - row(sq));
          }
          cell.append(pe);
        }
        // the attacker that lost its exchange: show it vanishing from where it stood
        if (fresh && v.lastMove.lost && sq === v.lastMove.from && v.lastExchange && !v.lastExchange.stands) {
          const ghost = pieceEl(v.lastExchange.color, v.lastExchange.piece);
          ghost.classList.add('ghost');
          cell.append(ghost);
        }
        if (targets.has(sq)) {
          cell.classList.add(targets.get(sq).capture ? 'target-cap' : 'target');
          cell.append(h('div', { class: 'dot' }));
        }
        if (v.inCheck && p && p.type === 'k' && p.color === v.turn) cell.classList.add('check');
        cell.addEventListener('click', () => onSquare(v, sq, pieces, myTurn));
        board.append(cell);
      }
    }
    if (v.pending && Date.now() < arrowUntil) {
      const fresh0 = arrowFor !== v.exchangeNo;
      arrowFor = v.exchangeNo;
      const x1 = col(v.pending.from) + 0.5, y1 = row(v.pending.from) + 0.5;
      const x2 = col(v.pending.to) + 0.5, y2 = row(v.pending.to) + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 8 8');
      svg.setAttribute('class', 'caparrow' + (fresh0 ? ' fresh' : ''));
      const sx = x1 + ux * 0.3, sy = y1 + uy * 0.3, ex = x2 - ux * 0.55, ey = y2 - uy * 0.55;
      const px = -uy, py = ux;
      svg.innerHTML = `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="shaft"/>`
        + `<polygon class="head" points="${x2 - ux * 0.15},${y2 - uy * 0.15} ${ex + px * 0.32},${ey + py * 0.32} ${ex - px * 0.32},${ey - py * 0.32}"/>`;
      board.append(svg);
      board.append(h('div', { class: 'capbanner' + (fresh0 ? ' fresh' : '') }, 'CAPTURE'));
    }
    lastPly = v.ply;
  }

  function onSquare(v, sq, pieces, myTurn) {
    if (!myTurn) return;
    const p = pieces[sq];
    if (selected && v.legal.some((m) => m.from === selected && m.to === sq)) {
      const promo = v.legal.some((m) => m.from === selected && m.to === sq && m.promotion) ? 'q' : undefined;
      const from = selected;
      selected = null;
      cb.onAction({ type: 'move', from, to: sq, promotion: promo });
      return;
    }
    selected = p && p.color === v.you && v.legal.some((m) => m.from === sq) ? sq : null;
    renderBoard(v, lastMeta.orientation);
  }

  function bar(v, seat, label) {
    const el = h('div', { class: 'pbar-inner' });
    el.append(
      h('div', { class: 'who' }, h('span', { class: 'dot-color ' + (seat === 'w' ? 'wd' : 'bd') }), `${label} (${NAME[seat]})`,
        v.turn === seat && v.phase === 'chess' && !v.result ? h('span', { class: 'turn' }, ' to move') : null),
    );
    const cap = h('div', { class: 'caps' });
    for (const t of v.captured[seat]) { const c = h('span', { class: 'cap' }); c.append(pieceEl(seat, t)); cap.append(c); }
    el.append(cap);
    return el;
  }

  function renderChessScreen(v, meta) {
    show('game');
    $('room-tag').textContent = meta.code ? `Room ${meta.code}` : meta.mode === 'local' ? 'Local test' : '';
    const opp = meta.mode === 'local' ? other(meta.orientation) : other(v.you);
    const me = meta.mode === 'local' ? meta.orientation : v.you;
    $('opp-bar').replaceChildren(bar(v, opp, meta.mode === 'local' ? NAME[opp] : (meta.oppName || 'Opponent')));
    $('me-bar').replaceChildren(bar(v, me, meta.mode === 'local' ? NAME[me] : 'You'));
    renderBoard(v, meta.orientation);

    let status;
    if (v.result) status = 'Game over';
    else if (v.phase === 'poker') status = 'Capture!';
    else if (meta.mode === 'local') status = `${NAME[v.turn]} to move${v.inCheck ? ' (check)' : ''}`;
    else status = v.turn === v.you ? `Your move${v.inCheck ? ' (you are in check)' : ''}` : `${meta.oppName || 'Opponent'}'s move`;
    $('status').textContent = status;
    $('btn-resign').hidden = !!v.result || meta.mode === 'local';

    const log = $('log');
    log.replaceChildren(...v.log.map((l) => h('div', { class: 'logline' }, l)));
    log.scrollTop = log.scrollHeight;

    const over = $('gameover');
    if (v.result) {
      over.hidden = false;
      const r = v.result;
      let title;
      if (r.winner === 'draw') title = 'Draw';
      else if (meta.mode === 'local') title = `${NAME[r.winner]} wins`;
      else title = r.winner === v.you ? 'You win!' : 'You lose';
      $('go-title').textContent = title;
      $('go-detail').textContent = `By ${r.reason}.`;
      $('btn-rematch').hidden = !(meta.mode === 'local' || meta.mode === 'ai' || meta.isHost);
      $('go-wait').hidden = meta.mode === 'local' || meta.mode === 'ai' || meta.isHost;
    } else over.hidden = true;

    $('notice').textContent = meta.notice || '';
    $('notice').hidden = !meta.notice;

    // announce how the last exchange ended
    const ex = v.lastExchange;
    if (!ex) seenExchange = 0;
    else if (seenExchange === undefined) seenExchange = ex.no;
    else if (ex.no !== seenExchange) {
      seenExchange = ex.no;
      toast(ex.stands
        ? `${NAME[ex.color]}'s ${PIECE[ex.piece]} takes the ${PIECE[ex.captured]}.`
        : `${NAME[ex.color]} lost the exchange. Their ${PIECE[ex.piece]} is gone.`);
    }
  }

  // ---------- capture pop-up ----------
  function renderIntro(v, meta) {
    const p = v.pending, bb = v.bb;
    const f = (c) => fmt(c, bb);
    const local = meta.mode === 'local';
    const me = v.you, opp = other(me);
    const nm = (s) => (local ? NAME[s] : s === me ? 'You' : (meta.oppName || 'Opponent'));
    const cap = p.color, def = other(p.color);
    const part = (s) => {
      const isCap = s === cap;
      const piece = isCap ? p.piece : p.captured;
      const lines = [`${RULES.baseStackBB} base`, `+ ${RULES.pieceValues[piece]} for the ${PIECE[piece]}`];
      if (isCap) lines.push(`+ ${RULES.initiatorBonusBB} for initiating`);
      else if (RULES.defenderPenaltyBB) lines.push(`- ${RULES.defenderPenaltyBB} for defending`);
      return h('div', { class: 'stackcard' + (isCap ? ' attacker' : '') },
        h('div', { class: 'who' }, nm(s), local ? null : h('span', { class: 'sub' }, ` (${NAME[s]})`)),
        h('div', { class: 'big' }, `${f(p.startStacks[s])} BB`),
        pileEl(p.startStacks[s], bb, { small: true }),
        h('ul', { class: 'brk' }, lines.map((l) => h('li', {}, l))),
        h('div', { class: 'role' }, isCap ? 'attacker · dealer' : 'defender'));
    };
    $('intro-box').replaceChildren(
      h('div', { class: 'kicker' }, p.isRecapture ? 'Recapture!' : 'Capture!'),
      h('div', { class: 'line' }, `${NAME[cap]}'s ${PIECE[p.piece]} takes ${NAME[def]}'s ${PIECE[p.captured]} on ${p.to}`),
      h('div', { class: 'versus' }, part(me), h('span', { class: 'vs' }, 'vs'), part(opp)),
      h('div', { class: 'foot' }, `One chip is one BB. Poker hands until one side is out of chips. If ${NAME[cap]} loses, the ${PIECE[p.piece]} is lost.`),
      h('div', { class: 'introbar' }, h('div', { class: 'fill', style: `animation-duration:${v.introMs}ms` })),
      h('div', { class: 'foot' }, 'The table opens when the timer ends, or skip ahead. The clock keeps running either way.'),
      h('button', { class: 'accent skip', onclick: () => { skippedFor = v.exchangeNo; $('intro').hidden = true; if (lastView) update(lastView, lastMeta); } }, 'Skip to the table'),
    );
  }

  // ---------- poker table ----------
  function actText(a, f) {
    if (!a) return '';
    const t = a.kind === 'fold' ? 'Fold'
      : a.kind === 'check' ? 'Check'
      : a.kind === 'call' ? `Call ${f(a.amount)} BB`
      : a.kind === 'bet' ? `Bet ${f(a.to)} BB`
      : `Raise to ${f(a.to)} BB`;
    return t + (a.allIn ? ' · all-in' : '');
  }

  function buildControls(v, hd, me, held) {
    const bb = v.bb;
    const f = (c) => fmt(c, bb);
    const o = hd.options;
    const opp = other(me);
    const wrap = h('div', { class: 'ctl' + (held ? ' held' : '') });
    wrap.append(h('div', { class: 'turnmsg' }, held ? 'Your turn is coming up…' : 'Your action'));
    const row = h('div', { class: 'btnrow' });
    row.append(h('button', { class: 'danger', disabled: held, onclick: () => cb.onAction({ type: 'poker', kind: 'fold' }) }, 'Fold'));
    if (o.canCheck) row.append(h('button', { disabled: held, onclick: () => cb.onAction({ type: 'poker', kind: 'check' }) }, 'Check'));
    else row.append(h('button', { class: 'callbtn', disabled: held, onclick: () => cb.onAction({ type: 'poker', kind: 'call' }) },
      `Call ${f(o.callAmount)} BB` + (o.callAmount >= hd.stacks[me] ? ' (all-in)' : '')));
    wrap.append(row);

    if (o.canRaise) {
      const lo = o.minRaiseTo, hi = o.maxRaiseTo;
      const step = hd.sb; // bets move in half-blind steps, so every chip on the table is a clean 0.5 BB
      const clamp = (c) => Math.max(lo, Math.min(hi, Math.round(c / step) * step));
      const verb = hd.bets.w === 0 && hd.bets.b === 0 ? 'Bet' : 'Raise to';
      const range = h('input', { type: 'range', min: lo, max: hi, value: lo, step: 1, disabled: held });
      const num = h('input', { type: 'number', min: lo / bb, max: hi / bb, step: 0.5, value: lo / bb, class: 'amt', inputmode: 'decimal', disabled: held });
      const setTo = (c) => { const x = clamp(c); range.value = x; num.value = x / bb; return x; };
      range.addEventListener('input', () => { num.value = Number(range.value) / bb; });
      num.addEventListener('input', () => { const c = Number(num.value) * bb; if (Number.isFinite(c)) range.value = clamp(c); });
      num.addEventListener('change', () => setTo(Number(num.value) * bb || lo));
      num.addEventListener('blur', () => setTo(Number(num.value) * bb || lo));
      const quick = h('div', { class: 'quick' });
      for (const [lbl, fr] of [['½ pot', 0.5], ['pot', 1], ['2× pot', 2]]) {
        quick.append(h('button', { class: 'small', disabled: held, onclick: () => setTo(hd.bets[opp] + (hd.pot + o.callAmount) * fr) }, lbl));
      }
      const go = h('button', { class: 'primary', disabled: held, onclick: () => {
        const c = setTo(Number(num.value) * bb || lo);
        cb.onAction({ type: 'poker', kind: 'raise', amount: c });
      } }, verb);
      const allin = h('button', { class: 'accent', disabled: held, onclick: () => cb.onAction({ type: 'poker', kind: 'allin' }) }, `All-in ${f(hi)} BB`);
      wrap.append(
        h('div', { class: 'rangeinfo' }, `Minimum ${f(lo)} BB · maximum ${f(hi)} BB`),
        range, quick,
        h('div', { class: 'btnrow' }, go, num, h('span', { class: 'unit' }, 'BB'), allin),
      );
    }
    return wrap;
  }

  function renderTable(v, meta) {
    const hd = v.hand, p = v.pending, bb = v.bb;
    const local = meta.mode === 'local';
    const me = v.you, opp = other(me);
    const oppName = meta.oppName || 'Opponent';
    const nm = (s) => (local ? NAME[s] : s === me ? 'You' : oppName);
    const f = (c) => fmt(c, bb);
    const cnt = (c) => chipCount(c, bb).n;
    const newHand = hd.id !== prev.id;
    const pv = newHand ? blankPrev() : prev;
    const held = v.holdMs > 0;
    const justDone = hd.done && pv.doneShown !== hd.id;
    const streetChanged = !newHand && !hd.done && hd.street !== pv.street;
    const sweeping = justDone || streetChanged;   // the bets on the felt go to the pot
    const still = reducedMotion();                // no flights: show the end state straight away
    const sbSeat = hd.button, bbSeat = other(hd.button);

    $('t-status').textContent = hd.done ? 'Hand finished' : `Exchange hand ${hd.handNo} · ${hd.street}`;
    $('t-room').textContent = meta.code ? `Room ${meta.code}` : local ? 'Local test' : '';
    $('btn-resign-t').hidden = !!v.result || local;
    $('t-notice').textContent = meta.notice || '';
    $('t-notice').hidden = !meta.notice;

    const st = p.startStacks, cap = p.color, def = other(p.color);
    $('t-capture').replaceChildren(
      h('div', { class: 'headline' }, `${NAME[cap]}'s ${PIECE[p.piece]} takes ${NAME[def]}'s ${PIECE[p.captured]} on ${p.to}${p.isRecapture ? ' (recapture)' : ''}`),
      h('div', { class: 'sub' }, `Started with ${NAME[cap]} ${f(st[cap])} BB, ${NAME[def]} ${f(st[def])} BB. If ${NAME[cap]} loses, the ${PIECE[p.piece]} is lost.`),
    );

    // ----- what chips have to do this time (decided from what changed since the last draw)
    const target = {};   // chips sitting on the felt for each seat once the decision is in
    for (const s of SEATS) target[s] = justDone ? (hd.endBets ? hd.endBets[s] : 0) : streetChanged ? (hd.sweep ? hd.sweep.bets[s] : 0) : hd.bets[s];
    const plan = [];     // [{ legs: ['pile:w', 'spot:w'], n, delay }]
    const arriveSpot = { w: 0, b: 0 }, arrivePile = { w: 0, b: 0 };
    let anyBet = false, lastLand = 0;
    for (const s of SEATS) {
      const delta = target[s] - pv.bets[s];
      if (delta <= 0) continue;
      const d0 = newHand ? 900 + (s === sbSeat ? 0 : 250) : 0;   // blinds go in after the cards are dealt
      plan.push({ legs: ['pile:' + s, 'spot:' + s], n: cnt(delta), delay: d0 });
      arriveSpot[s] = d0 + LEG_MS;
      lastLand = Math.max(lastLand, d0 + LEG_MS);
      anyBet = true;
    }
    let sweepStart = 0, potLand = 0, collectStart = null;
    if (sweeping) {
      sweepStart = anyBet ? lastLand + 450 : 300;
      for (const s of SEATS) if (target[s] > 0) plan.push({ legs: ['spot:' + s, 'pot'], n: cnt(target[s]), delay: sweepStart });
      potLand = sweepStart + LEG_MS;
    }
    if (justDone) {
      collectStart = potLand + 650;
      const win = hd.result.winner;
      const rec = win === 'tie' ? SEATS : [win];
      for (const s of rec) {
        plan.push({ legs: ['pot', 'pile:' + s], n: cnt(hd.pot / rec.length), delay: collectStart });
        arrivePile[s] = collectStart + LEG_MS;
      }
    }

    // ----- seats
    const pileEls = {}, spotEls = {};
    const nextActs = { w: JSON.stringify(hd.acts.w), b: JSON.stringify(hd.acts.b) };
    function seatEl(seat, isMe) {
      const role = seat === sbSeat ? 'SB' : 'BB';
      const acting = hd.toAct === seat && !hd.done;
      const a = hd.acts[seat];
      const stale = a && a.street !== hd.street;
      const fresh = a && nextActs[seat] !== pv.acts[seat];
      const justActed = !!a && (held || hd.done) && hd.lastActor === seat;
      let actLabel;
      if (justActed) actLabel = actText(a, f);   // the move that was just made stays on their card
      else if (acting) actLabel = isMe ? (held ? 'Get ready…' : 'Your turn') : (held ? 'Waiting…' : (meta.mode === 'ai' ? 'Thinking…' : 'Deciding…'));
      else actLabel = actText(a, f);
      const inOt = acting && v.clockMode === 'ot';
      const otLeft = v.overtime ? v.overtime[seat] : 0;
      const head = h('div', { class: 'seathead' },
        h('span', { class: 'nm' }, nm(seat)),
        local ? null : h('span', { class: 'tag col' }, NAME[seat]),
        seat === sbSeat ? h('span', { class: 'tag dealer', title: 'Dealer button' }, 'D') : null,
        h('span', { class: 'tag blind' }, `${role} ${f(role === 'SB' ? hd.sb : hd.bb)}`),
        v.overtimeTotal > 0 ? h('span', { class: 'tag ot' + (inOt ? ' on' : '') + (otLeft <= 0 ? ' none' : ''), title: 'Overtime bank for this exchange' }, `OT ${Math.ceil(otLeft / 1000)}s`) : null,
        h('span', { class: 'act' + (acting ? ' now' : '') + (stale && !acting && !justActed ? ' old' : '') + (fresh && !acting ? ' fresh' : '') + (justActed ? ' hl' : '') }, actLabel),
      );
      const cards = hd.hole[seat];
      const wrap = h('div', { class: 'cards' });
      const reveal = justDone && cards && !isMe && !local;   // the opponent's cards turning over
      for (let i = 0; i < 2; i++) {
        const el = cards ? cardEl(cards[i]) : cardEl(null, { faceDown: true });
        if (newHand) { el.classList.add('deal'); el.style.animationDelay = (i * 2 + (isMe ? 1 : 0)) * 0.18 + 's'; }
        else if (reveal) { el.classList.add('flip'); el.style.animationDelay = i * 0.12 + 's'; }
        wrap.append(el);
      }
      const nowStack = hd.stacks[seat];
      const prevStack = pv.stacks ? pv.stacks[seat] : null;
      const grow = prevStack != null && nowStack > prevStack && arrivePile[seat] > 0;
      const pile = pileEl(nowStack, bb, { from: grow ? cnt(prevStack) : null, delay: arrivePile[seat] });
      pileEls[seat] = pile;
      const stackbox = h('div', { class: 'stackbox' }, pile, h('div', { class: 'stk' }, `${f(nowStack)} BB`));
      const kids = [head, h('div', { class: 'cardrow' }, wrap, stackbox)];
      if (acting && v.actionMs > 0) {
        kids.push(h('div', { class: 'timer' + (inOt ? ' ot' : '') }, h('div', { id: 't-fill', class: 'fill' }), h('span', { id: 't-sec', class: 'sec' })));
      }
      const won = hd.done && hd.result.winner === seat;
      return h('div', { class: 'seatbox' + (acting ? ' acting' : '') + (won ? ' won' : '') + (justActed ? ' justacted k-' + a.kind : '') }, ...kids);
    }
    $('seat-opp').replaceChildren(seatEl(opp, false));
    $('seat-me').replaceChildren(seatEl(me, true));

    // ----- the oval: bets, blinds, board, pot, result
    function spotEl(seat) {
      const amt = sweeping && !still ? target[seat] : hd.bets[seat];
      const before = pv.bets[seat];
      const pile = pileEl(amt, bb, { from: amt > before ? cnt(before) : null, delay: arriveSpot[seat], small: true });
      spotEls[seat] = pile;
      const lbl = h('div', { class: 'lbl' }, amt > 0 ? `bet ${f(amt)} BB` : '');
      if (amt > before) { lbl.classList.add('late'); lbl.style.animationDelay = Math.round(arriveSpot[seat]) + 'ms'; }
      const box = h('div', { class: 'spotbox' }, pile, lbl);
      if (sweeping && !still && amt > 0) { box.classList.add('leaving'); box.style.setProperty('--ld', sweepStart + 'ms'); }
      return box;
    }
    $('spot-opp').replaceChildren(spotEl(opp));
    $('spot-me').replaceChildren(spotEl(me));

    $('t-blinds').replaceChildren(
      h('span', { class: 'tag blind' }, `Small blind ${f(hd.sb)} BB · ${nm(sbSeat)}`),
      h('span', { class: 'tag blind' }, `Big blind ${f(hd.bb)} BB · ${nm(bbSeat)}`),
    );
    $('t-dealer').replaceChildren(h('div', { class: 'dealerchip ' + (sbSeat === opp ? 'top' : 'bottom') + (newHand ? ' slide' : '') },
      h('span', { class: 'd' }, 'D'), h('small', {}, `dealer · ${nm(sbSeat)}`)));

    const bd = $('t-board');
    bd.replaceChildren();
    for (let i = 0; i < 5; i++) {
      if (hd.board[i] != null) {
        const c = cardEl(hd.board[i]);
        const fresh = newHand ? false : i >= (pv.boardN || 0);
        if (fresh) { c.classList.add('deal'); c.style.animationDelay = (sweeping ? potLand * 0.6 : 0) / 1000 + (i - (pv.boardN || 0)) * 0.15 + 's'; }
        bd.append(c);
      } else bd.append(emptyCardEl());
    }
    const settled = hd.done ? hd.pot : hd.pot - hd.bets.w - hd.bets.b;
    const potGrow = settled > pv.pot && potLand > 0;
    const potPile = pileEl(hd.done && still ? 0 : settled, bb, { from: potGrow ? cnt(pv.pot) : null, delay: potLand, small: true });
    if (collectStart != null) { potPile.classList.add('collect'); potPile.style.setProperty('--cd', collectStart + 'ms'); }
    $('t-potpile').replaceChildren(potPile);
    const potEl = $('t-pot');
    potEl.textContent = `Pot ${f(hd.pot)} BB`;
    if (hd.pot !== (pv.potTotal ?? 0)) { potEl.classList.remove('bump'); void potEl.offsetWidth; potEl.classList.add('bump'); }

    const rb = $('t-result');
    if (hd.done) {
      const r = hd.result;
      let l1;
      if (r.winner === 'tie') l1 = `Split pot, ${f(r.pot)} BB`;
      else {
        l1 = `${nm(r.winner)} ${(local || r.winner !== me) ? 'wins' : 'win'} ${f(r.pot)} BB`;
        l1 += r.reason === 'showdown' ? ` with ${r.names[r.winner]}` : ` (${nm(other(r.winner))} folded)`;
      }
      const l2 = hd.matchOver
        ? (hd.matchStands ? `Exchange over: ${NAME[cap]}'s ${PIECE[p.piece]} takes the ${PIECE[p.captured]}.` : `Exchange over: ${NAME[cap]}'s ${PIECE[p.piece]} is lost.`)
        : 'Next hand coming up…';
      rb.replaceChildren(h('div', { class: 'l1' }, l1), h('div', { class: 'l2' }, l2));
      rb.style.setProperty('--rd', (justDone ? potLand : 0) + 'ms');
      rb.hidden = false;
    } else rb.hidden = true;

    const act = $('t-actions');
    act.replaceChildren();
    if (!hd.done && hd.toAct === me && hd.options) act.append(buildControls(v, hd, me, held));
    else if (!hd.done) act.append(h('div', { class: 'turnmsg wait' }, `Waiting for ${nm(hd.toAct)}…`));

    const log = $('t-log');
    log.replaceChildren(...v.log.slice(-6).map((l) => h('div', { class: 'logline' }, l)));
    log.scrollTop = log.scrollHeight;

    clock = (!hd.done && hd.toAct && v.actionMs > 0) ? { end: Date.now() + v.actionMs, total: v.actionTotal || 20000, mode: v.clockMode } : null;

    // ----- chips in flight (the elements exist now, so their positions can be measured)
    const els = { pot: potPile };
    for (const s of SEATS) { els['pile:' + s] = pileEls[s]; els['spot:' + s] = spotEls[s]; }
    for (const fl of plan) flyChips(fl.legs.map((k) => els[k]), fl.n, { delay: fl.delay });

    prev = {
      id: hd.id, acts: nextActs, bets: { ...hd.bets }, stacks: { ...hd.stacks }, pot: settled, potTotal: hd.pot,
      street: hd.street, boardN: hd.board.length, doneShown: hd.done ? hd.id : null,
    };
  }

  // ---------- full update ----------
  function hideIntro() {
    clearTimeout(introTimer); clearTimeout(introTimer2);
    introUntil = 0; arrowUntil = 0;
    $('intro').hidden = true;
  }

  function update(v, meta) {
    lastView = v; lastMeta = meta;
    if (v.phase === 'poker' && v.hand) {
      selected = null;
      if (introFor !== v.exchangeNo) {
        // a new capture: arrow + CAPTURE on the board, then the pop-up with both stacks, then the table
        introFor = v.exchangeNo;
        introBuilt = 0;
        skippedFor = 0;
        const cms = v.captureMs || 0, ms = v.introMs || 0;
        arrowUntil = cms > 0 ? Date.now() + cms : 0;
        introUntil = ms > 0 ? Date.now() + cms + ms : 0;
        clearTimeout(introTimer); clearTimeout(introTimer2);
        const again = () => { if (lastView) update(lastView, lastMeta); };
        if (cms > 0) introTimer2 = setTimeout(again, cms);
        if (ms > 0) introTimer = setTimeout(() => { hideIntro(); again(); }, cms + ms);
      }
      if (skippedFor !== v.exchangeNo && Date.now() < arrowUntil) {
        $('intro').hidden = true;
        show('game');
        renderChessScreen(v, meta);
        return;
      }
      if (skippedFor !== v.exchangeNo && Date.now() < introUntil) {
        renderChessScreen(v, meta);
        if (introBuilt !== v.exchangeNo) { renderIntro(v, meta); introBuilt = v.exchangeNo; }
        $('intro').hidden = false;
        return;
      }
      hideIntro();
      show('table');
      renderTable(v, meta);
      return;
    }
    hideIntro();
    introFor = 0; introBuilt = 0;
    clock = null;
    prev = blankPrev();
    renderChessScreen(v, meta);
  }

  return {
    toast,
    showLobby(msg) { show('lobby'); $('lobby-msg').textContent = msg || ''; },
    showWaiting(code) {
      show('waiting');
      $('room-code').textContent = code || '…';
      const base = location.origin + location.pathname;
      $('share-link').value = code ? `${base}?join=${code}` : 'Creating room…';
      $('wait-status').textContent = code ? 'Waiting for your friend to join…' : 'Contacting the connection broker…';
    },
    showConnecting(text) { show('waiting'); $('room-code').textContent = ''; $('share-link').value = ''; $('wait-status').textContent = text; },
    fillJoinCode(c) { $('join-code').value = c; },
    thinking(on) { $('status').dataset.thinking = on ? '1' : ''; },
    update,
    refresh() { if (lastView) update(lastView, lastMeta); },
  };
}
