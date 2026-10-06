TILE PICTURES
=============

Put one picture per module into this folder. The file name is the module's
"art" name from scripts/catalog.js:

    ult-ls.webp        ULT's Loading Screen
    ult-rate.webp      ULT's Session Rating

Format
  - .webp is preferred (small). .png and .jpg work too; the Hub tries
    .webp first, then .png, then .jpg.
  - 16:9 landscape, 960 x 540 pixels is a good size (the tile shows it at
    about 260-520 px wide, so this stays sharp on high-density screens).
  - Keep each file under ~200 KB.
  - The bottom third of the picture fades into the tile, so keep the important
    part of the motif in the upper two thirds.

If a file is missing the tile shows the module's icon on a plain dark surface,
so nothing looks broken while pictures are still being made.

Compact tile size (a setting) crops the same picture to 21:9 from the centre.
