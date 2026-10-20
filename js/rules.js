// All the tunable numbers live here. Change them and reload; nothing else needs touching.
// Chip amounts are in chips; 1 BB = RULES.bb chips.

export const RULES = {
  bb: 10,                 // big blind in chips (so the small blind of 0.5 BB is 5 chips)
  sb: 5,

  // Every capture is its own mini-match. Each side starts with
  //   baseStackBB + (value of their piece in the exchange)
  // The capturer's piece is theirs; the defender's "piece" is the one just captured.
  // The capturer (the initiator) also gets initiatorBonusBB on top.
  // Example: a bishop (3) takes a pawn (1): capturer 3+3+2 = 8 BB, defender 3+1-2 = 2 BB.
  baseStackBB: 3,
  initiatorBonusBB: 2,
  // The defender is down this many BB (stack = base + piece value - penalty).
  defenderPenaltyBB: 2,
  pieceValues: { p: 1, n: 3, b: 3, r: 5, q: 9 },

  // The king plays normal chess: any king capture just happens, with no hand.
  kingCapturesAutomatic: true,

  // Only the king captures for free. A non-king piece that captures to escape check still has to
  // win the exchange; if it loses, the check stands and the king falls.
  forcedCapturesSkipHand: false,

  // Timing, all in milliseconds.
  timing: {
    moveMs: 20000,        // chess: time to make a move
    moveOtMs: 30000,      // chess: extra time on that move once it runs out, then forfeit
    startMs: 3800,        // 1, 2, 3, GO! before the game starts
    captureMs: 2500,      // arrow + "CAPTURE" on the board, then the pop-up
    introMs: 12300,       // the "Capture!" pop-up with both stacks
    dealMs: 3400,         // cards dealt and blinds posted at the start of every hand
    bufferMs: 2000,       // pause after every decision so the move and the chips can be seen
    actionMs: 20000,      // clock for each decision
    overtimeMs: 30000,    // extra time bank per player, refilled at the start of every exchange
    runoutFirstMs: 2000,  // all in: let the last action show before the board comes out
    runoutStepMs: 1200,   // all in: flop to turn goes quickly
    runoutRiverMs: 2400,  // all in: a longer pause before the river card
    runoutStallMs: 3400,  // all in: pause on the full board before the result
    pauseMs: 4800,        // a finished hand stays on the table (showdown, chips to the winner)
  },
};

// Starting stacks (in chips) for an exchange.
export function exchangeStacks(attackerPiece, capturedPiece, rules = RULES) {
  const v = rules.pieceValues;
  return {
    attacker: (rules.baseStackBB + v[attackerPiece] + (rules.initiatorBonusBB || 0)) * rules.bb,
    defender: Math.max(1, rules.baseStackBB + v[capturedPiece] - (rules.defenderPenaltyBB || 0)) * rules.bb,
  };
}
