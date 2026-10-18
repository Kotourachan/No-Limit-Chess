// Peer-to-peer transport over PeerJS (free public broker, no server of our own).
// The host's browser is the game server. Swap this file for a WebSocket version later
// and nothing else has to change.

const PREFIX = 'nolimitchess-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export function makeCode() {
  const a = new Uint32Array(5);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Host a room. Handlers: onCode(code), onGuest(), onMessage(msg), onGuestLeft(), onError(text)
export function hostRoom(h) {
  let conn = null;
  let peer = null;
  let tries = 0;

  function open() {
    const code = makeCode();
    peer = new Peer(PREFIX + code, { debug: 1 });
    peer.on('open', () => h.onCode(code));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries++ < 5) { try { peer.destroy(); } catch (_) {} open(); return; }
      h.onError(describe(e));
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (_) {} });
    peer.on('connection', (c) => {
      if (conn && conn.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
      conn = c;
      c.on('open', () => h.onGuest());
      c.on('data', (m) => h.onMessage(m));
      c.on('close', () => { if (conn === c) { conn = null; h.onGuestLeft(); } });
      c.on('error', () => {});
    });
  }
  open();
  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
    connected() { return !!(conn && conn.open); },
    close() { try { peer.destroy(); } catch (_) {} },
  };
}

// Join a room by code. Handlers: onOpen(), onMessage(msg), onClose(), onError(text)
export function joinRoom(code, h) {
  const peer = new Peer({ debug: 1 });
  let conn = null;
  peer.on('open', () => {
    conn = peer.connect(PREFIX + normalizeCode(code), { reliable: true });
    conn.on('open', () => h.onOpen());
    conn.on('data', (m) => h.onMessage(m));
    conn.on('close', () => h.onClose());
    conn.on('error', (e) => h.onError(describe(e)));
  });
  peer.on('error', (e) => h.onError(describe(e)));
  return {
    send(msg) { if (conn && conn.open) conn.send(msg); },
    close() { try { peer.destroy(); } catch (_) {} },
  };
}

function describe(e) {
  if (e && e.type === 'peer-unavailable') return 'No game found with that code. Check the code and make sure the host still has the page open.';
  if (e && e.type === 'network') return 'Could not reach the connection broker. Check your internet connection and try again.';
  if (e && e.type === 'browser-incompatible') return 'This browser does not support WebRTC.';
  return 'Connection problem: ' + ((e && (e.type || e.message)) || 'unknown');
}
