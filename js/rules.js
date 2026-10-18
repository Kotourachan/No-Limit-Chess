// All the tunable numbers live here. Change them and reload; nothing else needs touching.
// Chip amounts are in chips; 1 BB = RULES.bb chips.

export const RULES = {
  bb: 10,                 // big blind in chips (so the small blind of 0.5 BB is 5 chips)
  sb: 5,

  // Every capture is its own mini-match. Each side starts with
  //   (baseStackBB + value of their piece in the exchange) BB.
  // The capturer's piece is theirs; the defender's "piece" is the one just captured.
  // Example: a bishop (3) takes a pawn (1): capturer 6 BB, defender 4 BB.
  // A bishop taking a queen (9): capturer 6 BB, defender 12 BB. There is no extra bonus or
  // penalty for the difference in value, the piece values alone set the stacks.
  baseStackBB: 3,
  pieceValues: { p: 1, n: 3, b: 3, r: 5, q: 9 },

  // The king plays normal chess: any king capture just happens, with no hand.
  kingCapturesAutomatic: true,

  // Captures made while in check are forced, so they also skip the hand.
  forcedCapturesSkipHand: true,
};

// Starting stacks (in chips) for an exchange.
export function exchangeStacks(attackerPiece, capturedPiece, rules = RULES) {
  const v = rules.pieceValues;
  return {
    attacker: (rules.baseStackBB + v[attackerPiece]) * rules.bb,
    defender: (rules.baseStackBB + v[capturedPiece]) * rules.bb,
  };
}
