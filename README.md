# No-limit Chess

Chess where every capture is a poker hand. Static site, no server: two players connect browser-to-browser through
PeerJS's free public broker. The host's browser runs the game.

## Put it online with GitHub Pages (free)

1. Create a new **public** repository on github.com (free accounts only get Pages on public repos).
2. Unzip this project and drag its contents into the repo using **Add file > Upload files**
   (drag the `index.html`, `style.css`, `js`, `vendor`, `assets` items, plus `.nojekyll`). Commit.
   Don't upload `node_modules` or `test` if you don't want them there.
3. In the repo go to **Settings > Pages**, set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`, and save.
4. After a minute your game is live at `https://<your-username>.github.io/<repo-name>/`.

## Playing

- **Create game** gives you a 5-character code and a share link. Send either to a friend.
- Your friend opens the site, types the code under **Join game** (or just opens the link) and you're in.
- Colors are random. After a game the host can start a rematch with colors swapped.
- **Keep the host's tab open.** If you close it the game ends. If the guest drops, they can rejoin with the same code.
- **Play vs Computer** has its own lobby (pick your color and Easy or Normal). The AI is deliberately simple: a 1-2 ply chess search that knows captures are gambles, and a poker bot that compares Monte Carlo hand equity with pot odds. Good for testing, not strong.
- **Local test** plays both sides on one screen with all cards visible, handy for trying rules.

Opponent hole cards are only sent to the player who owns them, but because the host's browser runs the game, a
technical host could still peek. Fine for friends, not for anything competitive.

## The rules as implemented

All numbers are in `js/rules.js`.

- **Every capture is its own mini-match.** No global stack. Stacks are set when the capture is declared (BB = 10 chips):
  **3 BB base + the piece's value** for each side, the **initiator (capturer) gets +2 BB** and the **defender gets -2 BB**.
  Values: pawn 1, knight 3, bishop 3, rook 5, queen 9. No bonus for value differences.
  Example: pawn takes pawn is 6 BB vs 2 BB; bishop takes pawn is 8 BB vs 2 BB.
- Hands repeat (heads-up hold'em, blinds 0.5 / 1 BB) until one side is out of chips. The capturer is the dealer for the whole exchange
  (small blind, acts first preflop, last after).
- Capturer wins or splits the mini-match: the capture stands. Capturer loses: the **capturing piece is lost**, the defender stays put and the
  turn passes. A pinned piece that loses exposes its king and loses the game.
- **King captures are automatic** (no hand). Any other piece must win the exchange, even when capturing to escape check:
  if it loses, the capturing piece is lost and the check stands, but you still get a move: **the king must move** (king captures stay free).
  If the king has no legal move, it's checkmate.
- The capturer must show at showdown. The defender may muck a losing hand.
- **Capture sequence:** a glowing arrow and a CAPTURE banner appear on the board for 2.5 s, then a ~12 s pop-up with both stacks.
  Each player can press **Skip to the table** on their own screen; the shared timer keeps running, so nobody can act early and the other player can keep reading.
- **Pop-up and table:** after the pop-up (or a skip), then a separate oval table (the board is hidden).
  The dealer chip sits by the dealer. Blinds come out of the stacks, bets slide to the felt, and the pot sweeps to the winner.
  Chips are drawn one chip per BB.
- **Clocks:** 20 s per decision, then a **30 s overtime bank per player per exchange** (refills for every new exchange, not shared).
  Running out means check if free, otherwise fold. After every decision there is a 2 s pause where the move is highlighted on the player's card.
- **All-in run-out:** once both players are all in, both hands are turned up and the board is dealt in steps: 2 s after the last action the flop
  comes out quickly, the turn 1.2 s later, then a longer 2.4 s pause before the river, then 3.4 s on the full board before the result.
- **End of the exchange:** the winning piece grows to fill the screen with a big WIN (3 s, tap to skip), or LOSE in red when your opponent won, then the board returns.
- **Skipping the pop-up:** if you jump to the table early, a "Setting up the exchange…" bar counts down until play can start.
- Game ends on checkmate, stalemate or draw rules, resignation, or a king loss. Pawns auto-promote to queens for now.
- **Local test** mode uses a shorter pop-up and pause, with no clocks.

## Sound

All sound effects are synthesised in the browser (`js/sound.js`, Web Audio), so there are no audio files to host: piece moves and
captures, the CAPTURE alert, card deals and flips, chips landing (one click per chip), the dealer button, check knocks, fold swish and a
win / lose / split sting. The speaker button in the corner of every screen mutes everything and remembers your choice.
Browsers only allow audio after a tap, so the first sound starts once you have clicked something.

## Art

Everything visual has a named slot with a placeholder. See `assets/README.md` for filenames and sizes.

## Development

```
npm install      # only needed for the tests
npm test         # engine tests, 60 random full games, and AI-vs-AI games (takes about a minute)
```

Libraries vendored in `vendor/`: chess.js 1.4.0 and PeerJS 1.5.5 (so the site has no CDN dependencies).
Game logic (`js/rules.js`, `js/poker.js`, `js/game.js`) has no UI or network code. `js/net.js` is the only file that knows about PeerJS.
