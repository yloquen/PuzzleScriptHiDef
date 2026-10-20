This is a fork of PuzzleScript (https://www.puzzlescript.net) with 2 main goals:

1. Allow to add sprites that replace default objects (with fallback to original graphics if no sprites are defined).
2. Keep the game backwards compatible with existing levels.

Disclaimers:
The modifications are coded using AI.
I'm still experimenting with this so there might be changes.
Heroes of Sokoban games used as demo with permission by the author Jonah Ostroff.
----


## Sprites

Optional prelude lines replace an object's 5×5 graphic with a PNG. The built-in graphic is still used when the line is missing or the image cannot be loaded. Paths are relative to `src/` (the folder the local server serves).

```
sprite Player assets/minimal/player.png
sprite Player assets/minimal/player_idle.png anim=idle frames=3
sprite Box assets/minimal/box.png anim=still
```

One line is one clip. A later line for the same object and clip replaces the earlier one.

Frames run left to right on one row, 16 pixels tall, drawn facing right. Moving left mirrors that row. Moving up or down keeps the last side, including the mirror. Each cell is 16×16 unless `frame` says otherwise.

| Option | Default | Meaning |
| --- | --- | --- |
| `anim` | `walk` | `walk` cycles during a one-cell slide. `idle` cycles while standing. `still` is one picture and only tweens position. |
| `frame` | `16` | Cell size. `16x32` sets width and height. |
| `frames` | whole row | How many columns count as the clip. |
| `scale` | `1` | Multiplies how long each frame stays up. The base hold is 50ms, so `2` holds each frame for 100ms and `0.5` for 25ms. |
| `bright` | `1` | Multiplies red, green, and blue. `0.5` draws the same sheet at half strength. Alpha is left alone. |
| `loop` | `true` | `false` plays an idle clip once from the moment that object appears, then holds the last frame. Each copy plays on its own. `true` repeats it. |
| `rows` | one right-facing row | Optional direction rows, top to bottom. Without it, left is a mirror of the single row. |

A walk slide lasts long enough to show each of its frames once at that pace. A 4-frame walk at the default scale is 200ms. Holding a direction steps again as soon as the slide ends, so the walk keeps going. Letting go during the slide stops on the cell you are entering. Several copies of one object, such as a row of crates, each slide one cell.

While you're editing a game, put the assets in src/assets/... (see PuzzleScriptHiDef demo games for example)
Sprites are encoded in Base64 when exporting a game, so they are included inside the .html file.
