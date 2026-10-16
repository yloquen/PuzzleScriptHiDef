PuzzleScript
============

Open Source HTML5 Puzzle Game Engine

Try it out at https://www.puzzlescript.net.

-----

If you're interested in recompiling/modifing/hacking the engine, there is [development setup info here](DEVELOPMENT.md).  If you're just interested in learning how to use the engine/make games in it, [the documentation is here](https://www.puzzlescript.net/Documentation/documentation.html).

-----

## Sprites

Optional prelude lines replace an object's 5×5 graphic with a PNG. The built-in graphic is still used when the line is missing or the image cannot be loaded. Paths are relative to `src/` (the folder the local server serves).

```
sprite Player assets/minimal/player.png
sprite Player assets/minimal/player_idle.png anim=idle frames=3
sprite Box assets/minimal/box.png anim=still
```

One line is one clip. A later line for the same object and clip replaces the earlier one.

Frames run left to right. Direction rows run top to bottom: up, left, down, right. Each cell is 16×16 unless `frame` says otherwise. Left and right are their own rows. Moving up or down keeps the last side-facing row.

| Option | Default | Meaning |
| --- | --- | --- |
| `anim` | `walk` | `walk` cycles during a one-cell slide. `idle` cycles while standing. `still` is one picture and only tweens position. |
| `frame` | `16` | Cell size. `16x32` sets width and height. |
| `frames` | whole row | How many columns count as the clip. |
| `scale` | `1` | Multiplies how long each frame stays up. The base hold is 50ms, so `2` holds each frame for 100ms and `0.5` for 25ms. |
| `bright` | `1` | Multiplies red, green, and blue. `0.5` draws the same sheet at half strength. Alpha is left alone. |
| `rows` | `up,left,down,right` | Top-to-bottom direction order. A sheet with one row is used for every direction. |

A walk slide lasts long enough to show each of its frames once at that pace. A 4-frame walk at the default scale is 200ms. Holding a direction keeps stepping at that pace, and one further move can be queued during a slide. Several copies of one object, such as a row of crates, each slide one cell.
