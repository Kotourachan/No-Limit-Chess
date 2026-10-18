# Dropping in your art

Every visual in the game has a name. To use your own image, put the file in this folder and add a line to
`manifest.json` mapping the name to the filename. Anything you don't list keeps its built-in placeholder, so you
can swap art in one piece at a time. After editing, refresh the page (hard refresh if the browser cached the old manifest).

Example `manifest.json`:

```json
{
  "piece_white_knight": "white_knight.png",
  "piece_black_knight": "black_knight.png",
  "card_back": "card_back.png",
  "card_As": "ace_of_spades.png",
  "board_light": "light_square.png",
  "board_dark": "dark_square.png"
}
```

## Names

**Pieces** (transparent PNG or SVG, square, about 256x256): `piece_white_king`, `piece_white_queen`, `piece_white_rook`,
`piece_white_bishop`, `piece_white_knight`, `piece_white_pawn`, and the same six with `piece_black_`.

**Board squares** (tiled per square, about 128x128): `board_light`, `board_dark`.

**Cards** (portrait, about 140x196, 5:7 ratio): `card_back`, and one per card named rank + suit letter. Ranks are
`2 3 4 5 6 7 8 9 T J Q K A`, suits are `s` spades, `h` hearts, `d` diamonds, `c` clubs. So `card_As`, `card_Td`, `card_2c`.
That is 52 faces plus the back.

Not wired up yet (planned slots): chips, dealer button, sounds, banners.
