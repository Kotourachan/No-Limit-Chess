import { Game } from './game.js';
import { hostRoom, joinRoom, normalizeCode } from './net.js';
import { createUI } from './ui.js';
import { loadSkin } from './skin.js';
import { chooseMove, choosePokerAction } from './ai.js';
import { RULES } from './rules.js';

let mode = null; // 'host' | 'guest' | 'local' | 'ai'
let aiColor = 'b';
let aiLevel = 'normal';
let humanColor = 'w';
let aiTimer = null;
let game = null;
let net = null;
let code = null;
let hostColor = 'w';
let guestView = null;
let guestColor = null;
let notice = '';

const ui = createUI({
  onCreate: startHosting,
  onJoin: startJoining,
  onLocal: startLocal,
  onAi: startAi,
  onLeave: () => { try { net && net.close(); } catch (_) {} location.href = location.pathname; },
  onAction: handleAction,
  onRematch: rematch,
});

function other(s) { return s === 'w' ? 'b' : 'w'; }

// Timing lives in rules.js. The local test (you play both sides) has no clocks, a shorter
// capture pop-up and a shorter pause after each decision.
function makeGame() {
  const T = RULES.timing;
  const local = mode === 'local';
  return new Game({
    manualAdvance: true,
    moveMs: local ? 0 : T.moveMs,
    moveOtMs: local ? 0 : T.moveOtMs,
    startMs: T.startMs,
    actionMs: local ? 0 : T.actionMs,
    overtimeMs: local ? 0 : T.overtimeMs,
    captureMs: local ? 1500 : T.captureMs,
    introMs: local ? 4000 : T.introMs,
    dealMs: T.dealMs,
    bufferMs: local ? 800 : T.bufferMs,
    runoutFirstMs: T.runoutFirstMs,
    runoutStepMs: T.runoutStepMs,
    runoutRiverMs: T.runoutRiverMs,
    runoutStallMs: T.runoutStallMs,
    pauseMs: T.pauseMs,
  });
}

// ---------- hosting ----------
function startHosting() {
  mode = 'host';
  ui.showWaiting(null);
  net = hostRoom({
    onCode: (c) => { code = c; ui.showWaiting(c); },
    onGuest: () => {
      notice = '';
      if (!game) { newGame(Math.random() < 0.5 ? 'w' : 'b'); }
      pushViews();
    },
    onMessage: (m) => {
      if (m.t === 'act') {
        const r = game.apply(other(hostColor), m.action);
        if (!r.ok) net.send({ t: 'error', error: r.error });
        pushViews();
      }
    },
    onGuestLeft: () => { notice = 'Your opponent disconnected. They can rejoin with the same code.'; pushViews(); },
    onError: (text) => { ui.showLobby(text); },
  });
}

function newGame(color) {
  hostColor = color;
  game = makeGame();
}

function pushViews() {
  if (!game) return;
  ui.update(game.viewFor(hostColor), { mode: 'host', code, isHost: true, orientation: hostColor, notice });
  net.send({ t: 'assign', color: other(hostColor) });
  net.send({ t: 'view', view: game.viewFor(other(hostColor)) });
}

function rematch() {
  if (mode === 'local') { startLocal(); return; }
  if (mode === 'ai') { humanColor = other(humanColor); startAiGame(); return; }
  if (mode !== 'host') return;
  newGame(other(hostColor));
  pushViews();
}

// ---------- joining ----------
function startJoining(raw) {
  const c = normalizeCode(raw);
  if (c.length !== 5) { ui.showLobby('Enter the 5-character game code.'); return; }
  mode = 'guest';
  code = c;
  ui.showConnecting(`Joining ${c}…`);
  net = joinRoom(c, {
    onOpen: () => ui.showConnecting('Connected. Waiting for the game to start…'),
    onMessage: (m) => {
      if (m.t === 'assign') guestColor = m.color;
      else if (m.t === 'view') { guestView = m.view; notice = ''; renderGuest(); }
      else if (m.t === 'error') ui.toast(m.error);
      else if (m.t === 'full') { ui.showLobby('That game already has two players.'); }
    },
    onClose: () => { notice = 'Disconnected from the host. Reload the page and rejoin with the same code.'; if (guestView) renderGuest(); else ui.showLobby('Lost connection to the host.'); },
    onError: (text) => ui.showLobby(text),
  });
}

function renderGuest() {
  if (!guestView) return;
  ui.update(guestView, { mode: 'guest', code, isHost: false, orientation: guestView.you, notice });
}

// ---------- local test (one screen, both sides) ----------
function startLocal() {
  mode = 'local';
  game = makeGame();
  renderLocal();
}

let localSeat = 'w';
function actor() {
  const t = game.phase === 'poker' && game.hand ? game.hand.toAct : game.chess.turn();
  if (t) localSeat = t; // between hands nobody acts: keep the same point of view
  return localSeat;
}

function renderLocal() {
  const seat = actor();
  ui.update(game.viewFor(seat, { god: true }), { mode: 'local', code: null, isHost: true, orientation: 'w', notice: '' });
}

// ---------- vs computer ----------
function startAi({ color, level }) {
  mode = 'ai';
  aiLevel = level;
  humanColor = color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
  startAiGame();
}

function startAiGame() {
  clearTimeout(aiTimer);
  game = makeGame();
  aiColor = other(humanColor);
  renderAi();
  scheduleAi();
}

function renderAi() {
  ui.update(game.viewFor(humanColor), { mode: 'ai', code: null, isHost: true, orientation: humanColor, notice: '', oppName: 'Computer' });
}

function aiToAct() {
  if (!game || game.phase === 'over') return false;
  if (game.phase === 'poker') return game.hand && game.hand.toAct === aiColor;
  return game.chess.turn() === aiColor;
}

function scheduleAi() {
  clearTimeout(aiTimer);
  const thinking = aiToAct();
  ui.thinking(thinking);
  if (!thinking) return;
  // wait out the pop-up / deal / the move just made, then think for a moment
  const wait = game.phase === 'poker' ? game.holdRemaining() : game.startRemaining();
  const think = game.phase === 'poker' ? 800 + Math.random() * 700 : 350;
  aiTimer = setTimeout(() => {
    if (mode !== 'ai' || !aiToAct()) return;
    if ((game.phase === 'poker' && game.holdRemaining() > 0) || (game.phase !== 'poker' && game.startRemaining() > 0)) { scheduleAi(); return; }
    if (game.phase === 'poker') {
      const a = choosePokerAction(game, aiColor, aiLevel);
      game.apply(aiColor, { type: 'poker', ...a });
    } else {
      const m = chooseMove(game, aiColor, aiLevel);
      game.apply(aiColor, { type: 'move', ...m });
    }
    renderAi();
    scheduleAi();
  }, wait + think);
}

// ---------- actions ----------
function handleAction(a) {
  if (mode === 'local') {
    const r = game.apply(actor(), a);
    if (!r.ok) ui.toast(r.error);
    renderLocal();
  } else if (mode === 'ai') {
    if (aiToAct() && a.type !== 'resign') return;
    const r = game.apply(humanColor, a);
    if (!r.ok) ui.toast(r.error);
    renderAi();
    scheduleAi();
  } else if (mode === 'host') {
    const r = game.apply(hostColor, a);
    if (!r.ok) ui.toast(r.error);
    pushViews();
  } else if (mode === 'guest') {
    net.send({ t: 'act', action: a });
  }
}

// ---------- clock and hand pauses ----------
function refresh() {
  if (mode === 'host') pushViews();
  else if (mode === 'ai') { renderAi(); scheduleAi(); }
  else if (mode === 'local') renderLocal();
}

setInterval(() => {
  if (!game || !mode || mode === 'guest') return; // the host (or local session) keeps time
  if (game.tick()) refresh();
}, 200);

// ---------- boot ----------
await loadSkin();
const params = new URLSearchParams(location.search);
if (params.get('join')) {
  ui.fillJoinCode(normalizeCode(params.get('join')));
  startJoining(params.get('join'));
} else {
  ui.showLobby('');
}
