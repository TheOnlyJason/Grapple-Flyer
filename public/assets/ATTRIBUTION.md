# Player sprite — `paper-airplane.png`

Processed from user-provided Gemini paper airplane artwork.

Pipeline: `node scripts/prepare-plane-asset.mjs <source.png>`

- Removes black background (transparent PNG)
- Flips horizontally so the nose points right (game direction)
- Recolors toward cyan-blue to match the game palette

Source files were provided in chat (Gemini generated PNGs).

The legacy `paper-airplane.svg` is kept for reference but the game uses the PNG.
