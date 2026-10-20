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

- Normal chess. A capture starts its own heads-up poker mini-match. No chips carry between exchanges.
- **Stacks:** each side starts with 3 BB plus the value of their piece in the exchange. The capturer's piece is theirs, the defender's is the
  piece just captured. Bishop (3) takes pawn (1): capturer 6 BB, defender 4 BB. Bishop takes queen (9): 6 BB vs 12 BB. Pawn takes pawn: 4 BB each. There is no extra bonus for the difference in value. Values: pawn 1, knight 3, bishop 3, rook 5, queen 9.
- **Blinds:** 0.5 / 1 BB (BB = 10 chips in the code). The capturer (initiator) keeps the button for every hand of the exchange.
  The button player posts the small blind and acts first preflop and last after the flop.
- **Hands repeat until one player is out of chips.** If the capturer wins the mini-match the capture stands. If they lose, the capturing
  piece is lost (the defender stays where it was) and the move is spent. One edge case: a pinned piece that takes its pinner and then loses
  leaves its own king exposed, and that loses the game on the spot.
- **Recapture:** capturing on the square your opponent just captured on is just another exchange, with the recapturer as the capturer
  (so the recapturer gets the button).
- **Showdown:** the capturer must show if called; the defender can muck a losing hand. If someone folds, nobody shows.
- **Clock:** every poker decision has 10 seconds (the first one of an exchange gets a few extra seconds for the pop-up and the deal).
  Run out of time and you check if that is free, otherwise you fold. There is no clock in Local test.
- **King:** captures by the king are automatic. They skip the poker and just happen. A capture made while you're in check is also forced
  and skips the hand.
- Game ends on checkmate, stalemate or draw rules, or resignation. Pawns auto-promote to queens for now.

## What you see

- **Capture pop-up:** when someone takes a piece, a short pop-up shows both starting stacks (3 BB base plus the piece value), then the
  board gives way to the poker table.
- **Poker table:** an oval table with the two players on opposite sides, everything in big blinds. Each seat shows the dealer button,
  its blind (SB 0.5 or BB 1), the player's last action, their stack right next to their cards, and their current bet. The blinds are
  also written on the table between the players. The player to act has a highlighted seat and a countdown bar.
- Finished hands stay on the table for a few seconds (showdown cards turn over, result banner) before the next hand or the board.
- Animations: cards are dealt in, actions pop in, the pot bumps when it changes, chess pieces slide, and a lost attacker vanishes.
  They switch off if the system asks for reduced motion.

## Art

Everything visual has a named slot with a placeholder. See `assets/README.md` for filenames and sizes.

## Development

```
npm install      # only needed for the tests
npm test         # engine tests, 60 random full games, and AI-vs-AI games (takes about a minute)
```

Libraries vendored in `vendor/`: chess.js 1.4.0 and PeerJS 1.5.5 (so the site has no CDN dependencies).
Game logic (`js/rules.js`, `js/poker.js`, `js/game.js`) has no UI or network code. `js/net.js` is the only file that knows about PeerJS.
