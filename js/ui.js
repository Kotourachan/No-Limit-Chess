// Placeholder UI. Everything visual goes through skin.js so art can be dropped in later.
import { pieceEl, cardEl, emptyCardEl, squareBg } from './skin.js';

const $ = (id) => document.getElementById(id);
const other = (s) => (s === 'w' ? 'b' : 'w');
const NAME = { w: 'White', b: 'Black' };
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

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

export function createUI(cb) {
  let selected = null;
  let lastView = null;
  let lastMeta = {};
  let toastTimer = null;

  const screens = ['lobby', 'waiting', 'game', 'ai'];
  function show(name) { for (const s of screens) $(s).hidden = s !== name; }

  // ---------- lobby wiring ----------
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
  $('btn-resign').onclick = () => { if (confirm('Resign this game?')) cb.onAction({ type: 'resign' }); };
  $('btn-rematch').onclick = () => cb.onRematch();
  $('btn-copy').onclick = async () => {
    const url = $('share-link').value;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { $('share-link').select(); }
  };

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  // ---------- board ----------
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
    if (v.pending) { hl.add(v.pending.from); hl.add(v.pending.to); }
    else if (v.lastExchange) { hl.add(v.lastExchange.from); hl.add(v.lastExchange.to); }

    for (const r of rl) {
      for (const f of fl) {
        const sq = f + r;
        const light = (files.indexOf(f) + r) % 2 === 1;
        const cell = h('div', { class: 'sq ' + (light ? 'light' : 'dark'), 'data-sq': sq });
        const bg = squareBg(light);
        if (bg) cell.style.backgroundImage = bg;
        if (hl.has(sq)) cell.classList.add(v.pending ? 'pending' : 'lastmove');
        if (selected === sq) cell.classList.add('selected');
        const p = pieces[sq];
        if (p) cell.append(pieceEl(p.color, p.type));
        if (targets.has(sq)) {
          cell.classList.add(targets.get(sq).capture ? 'target-cap' : 'target');
          cell.append(h('div', { class: 'dot' }));
        }
        if (v.inCheck && p && p.type === 'k' && p.color === v.turn) cell.classList.add('check');
        cell.addEventListener('click', () => onSquare(v, sq, pieces, myTurn));
        board.append(cell);
      }
    }
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

  // ---------- player bars ----------
  function bar(v, seat, label) {
    const el = h('div', { class: 'pbar-inner' });
    el.append(
      h('div', { class: 'who' }, h('span', { class: 'dot-color ' + (seat === 'w' ? 'wd' : 'bd') }), `${label} (${NAME[seat]})`,
        v.turn === seat && v.phase === 'chess' && !v.result ? h('span', { class: 'turn' }, ' to move') : null),
    );
    if (v.hand) {
      const behind = v.hand.stacks[seat];
      const inPlay = behind + v.hand.bets[seat];
      el.append(h('div', { class: 'stack' }, `${inPlay} chips`, h('span', { class: 'bbs' }, ` ${(inPlay / v.bb).toFixed(1)} BB`)));
    }
    const cap = h('div', { class: 'caps' });
    for (const t of v.captured[other(seat)]) { const c = h('span', { class: 'cap' }); c.append(pieceEl(other(seat), t)); cap.append(c); }
    el.append(cap);
    return el;
  }

  // ---------- poker panel ----------
  function holeRow(v, seat, label) {
    const row = h('div', { class: 'hole' });
    const cards = v.hand.hole[seat];
    row.append(h('div', { class: 'lbl' }, label));
    const wrap = h('div', { class: 'cards' });
    if (cards) cards.forEach((c) => wrap.append(cardEl(c)));
    else { wrap.append(cardEl(null, { faceDown: true })); wrap.append(cardEl(null, { faceDown: true })); }
    row.append(wrap);
    if (v.hand.bets[seat] > 0) row.append(h('div', { class: 'bet' }, `bet ${v.hand.bets[seat]}`));
    return row;
  }

  function renderPoker(v, meta) {
    const box = $('poker');
    box.innerHTML = '';
    if (!v.hand) { box.hidden = true; return; }
    box.hidden = false;
    const hd = v.hand;
    const p = v.pending;
    const me = v.you, opp = other(me);
    const who = (s) => (meta.mode === 'local' ? NAME[s] : s === me ? 'You' : (meta.oppName || 'Opponent'));

    box.append(h('h3', {}, `Exchange hand ${hd.handNo} (${hd.street})`));
    if (p) {
      const st = p.startStacks;
      box.append(h('p', { class: 'cap-line' },
        `${NAME[p.color]}'s ${PIECE[p.piece]} takes ${NAME[other(p.color)]}'s ${PIECE[p.captured]} on ${p.to}${p.isRecapture ? ' (recapture)' : ''}. `,
        `Mini-match: ${NAME[p.color]} ${(st[p.color] / v.bb)} BB vs ${NAME[other(p.color)]} ${(st[other(p.color)] / v.bb)} BB. Play hands until one player is out of chips. `,
        `If ${NAME[p.color]} wins, the capture stands.`));
      box.append(h('p', { class: 'meta' }, `Button: ${NAME[hd.button]} (capturer, shows if called) · blinds ${hd.sb / v.bb} / ${hd.bb / v.bb} BB`));
    }
    box.append(holeRow(v, opp, meta.mode === 'local' ? NAME[opp] : (meta.oppName || 'Opponent')));
    const bd = h('div', { class: 'cards board-cards' });
    for (let i = 0; i < 5; i++) bd.append(hd.board[i] != null ? cardEl(hd.board[i]) : emptyCardEl());
    box.append(h('div', { class: 'potline' }, h('span', { class: 'pot' }, `Pot ${hd.pot}`)), bd);
    box.append(holeRow(v, me, meta.mode === 'local' ? NAME[me] : 'You'));

    const act = h('div', { class: 'actions' });
    if (hd.toAct === me && hd.options) {
      const o = hd.options;
      act.append(h('div', { class: 'turnmsg' }, meta.mode === 'local' ? `${NAME[me]} to act` : 'Your action'));
      const row = h('div', { class: 'btnrow' });
      row.append(h('button', { class: 'danger', onclick: () => cb.onAction({ type: 'poker', kind: 'fold' }) }, 'Fold'));
      if (o.canCheck) row.append(h('button', { onclick: () => cb.onAction({ type: 'poker', kind: 'check' }) }, 'Check'));
      else row.append(h('button', { onclick: () => cb.onAction({ type: 'poker', kind: 'call' }) }, `Call ${o.callAmount}`));
      act.append(row);
      if (o.canRaise) {
        const verb = hd.bets.w === 0 && hd.bets.b === 0 ? 'Bet' : 'Raise to';
        const num = h('input', { type: 'number', min: o.minRaiseTo, max: o.maxRaiseTo, value: o.minRaiseTo, class: 'amt' });
        const range = h('input', { type: 'range', min: o.minRaiseTo, max: o.maxRaiseTo, value: o.minRaiseTo, step: 1 });
        range.addEventListener('input', () => (num.value = range.value));
        num.addEventListener('input', () => (range.value = num.value));
        const quick = h('div', { class: 'quick' });
        const pot = hd.pot;
        for (const [lbl, f] of [['½ pot', 0.5], ['pot', 1], ['2× pot', 2]]) {
          quick.append(h('button', { class: 'small', onclick: () => {
            const to = Math.round(hd.bets[opp] + (pot + o.callAmount) * f);
            const val = Math.max(o.minRaiseTo, Math.min(o.maxRaiseTo, to));
            num.value = val; range.value = val;
          } }, lbl));
        }
        const row2 = h('div', { class: 'btnrow' },
          h('button', { class: 'primary', onclick: () => cb.onAction({ type: 'poker', kind: 'raise', amount: Number(num.value) }) }, verb),
          num,
          h('button', { class: 'accent', onclick: () => cb.onAction({ type: 'poker', kind: 'allin' }) }, o.isAllInMax ? 'All-in' : `Max (${o.maxRaiseTo})`));
        act.append(range, quick, row2);
      }
    } else {
      act.append(h('div', { class: 'turnmsg wait' }, `Waiting for ${who(hd.toAct)}…`));
    }
    box.append(act);
  }

  function renderLastHand(v, meta) {
    const box = $('lasthand');
    box.innerHTML = '';
    if (!v.lastHand) { box.hidden = true; return; }
    box.hidden = false;
    const lh = v.lastHand;
    const ex = v.lastExchange;
    box.append(h('h3', {}, 'Last hand'));
    if (ex && !v.hand) box.append(h('p', { class: 'cap-line ' + (ex.stands ? 'stands' : 'fails') },
      ex.stands ? `The capture on ${ex.to} stands.` : `The capture on ${ex.to} failed. Pieces stay put and ${NAME[ex.color]}'s move is spent.`));
    box.append(h('p', { class: 'meta' }, lh.text));
    const bd = h('div', { class: 'cards board-cards small' });
    lh.board.forEach((c) => bd.append(cardEl(c)));
    if (lh.board.length) box.append(bd);
    for (const s of ['w', 'b']) {
      if (lh.hole[s]) {
        const r = h('div', { class: 'cards small' });
        lh.hole[s].forEach((c) => r.append(cardEl(c)));
        box.append(h('div', { class: 'lhrow' }, h('span', { class: 'lbl' }, NAME[s] + (lh.result.names[s] ? ` · ${lh.result.names[s]}` : '')), r));
      }
    }
  }

  // ---------- full update ----------
  function update(v, meta) {
    lastView = v; lastMeta = meta;
    show('game');
    if (v.phase !== 'chess') selected = null;
    $('room-tag').textContent = meta.code ? `Room ${meta.code}` : meta.mode === 'local' ? 'Local test' : '';
    const opp = meta.mode === 'local' ? other(meta.orientation) : other(v.you);
    const me = meta.mode === 'local' ? meta.orientation : v.you;
    $('opp-bar').replaceChildren(bar(v, opp, meta.mode === 'local' ? NAME[opp] : (meta.oppName || 'Opponent')));
    $('me-bar').replaceChildren(bar(v, me, meta.mode === 'local' ? NAME[me] : 'You'));
    renderBoard(v, meta.orientation);
    renderPoker(v, meta);
    renderLastHand(v, meta);

    let status;
    if (v.result) status = 'Game over';
    else if (v.phase === 'poker') status = 'Capture hand in progress';
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
      $('btn-rematch').hidden = !(meta.mode === 'local' || meta.isHost);
      $('go-wait').hidden = meta.mode === 'local' || meta.isHost;
    } else over.hidden = true;

    $('notice').textContent = meta.notice || '';
    $('notice').hidden = !meta.notice;
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
    thinking(on) { $('status').dataset.thinking = on ? '1' : ''; },
    showConnecting(text) { show('waiting'); $('room-code').textContent = ''; $('share-link').value = ''; $('wait-status').textContent = text; },
    fillJoinCode(c) { $('join-code').value = c; },
    update,
    refresh() { if (lastView) update(lastView, lastMeta); },
  };
}
