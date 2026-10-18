// Asset slots. Every visual has a name. If assets/manifest.json maps that name to a file,
// the image is used; otherwise a built-in placeholder is drawn. See assets/README.md.

const manifest = {};

export async function loadSkin() {
  try {
    const r = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (r.ok) Object.assign(manifest, await r.json());
  } catch (e) { /* no manifest, placeholders only */ }
}

export function slot(name) {
  return manifest[name] ? 'assets/' + manifest[name] : null;
}

const GLYPH = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};
const PNAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

export function pieceEl(color, type) {
  const name = `piece_${color === 'w' ? 'white' : 'black'}_${PNAME[type]}`;
  const url = slot(name);
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = name; img.draggable = false; img.className = 'piece-img';
    return img;
  }
  const s = document.createElement('span');
  s.className = 'piece-glyph ' + (color === 'w' ? 'pw' : 'pb');
  s.textContent = GLYPH.b[type]; // solid glyphs for both colors, tinted by CSS
  return s;
}

const RANKS = '23456789TJQKA';
const SUITS = '♠♥♦♣';
const SUIT_LETTERS = 'shdc';

export function cardEl(id, { faceDown = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (faceDown || id == null) {
    const url = slot('card_back');
    el.classList.add('back');
    if (url) el.style.backgroundImage = `url(${url})`;
    return el;
  }
  const rank = RANKS[id % 13];
  const suitIdx = Math.floor(id / 13);
  const url = slot(`card_${rank}${SUIT_LETTERS[suitIdx]}`);
  if (url) {
    el.style.backgroundImage = `url(${url})`;
    el.classList.add('img');
  } else {
    el.classList.add(suitIdx === 1 || suitIdx === 2 ? 'red' : 'black');
    el.innerHTML = `<span class="r">${rank === 'T' ? '10' : rank}</span><span class="s">${SUITS[suitIdx]}</span>`;
  }
  return el;
}

export function emptyCardEl() {
  const el = document.createElement('div');
  el.className = 'card empty';
  return el;
}

export function squareBg(light) {
  const url = slot(light ? 'board_light' : 'board_dark');
  return url ? `url(${url})` : '';
}
