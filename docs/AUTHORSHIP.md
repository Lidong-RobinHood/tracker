# Authorship of the body-map artwork

- **What:** the body map (front and back silhouette with 12 muscle regions) and the 12 per-muscle icons
  cut from it, shown by `src/ui/bodymap.js`.
- **When:** created for this project on 2026-11-19.
- **How:** hand-authored as coordinates (control points of the silhouette and muscle shapes, mirrored about
  the centre line) in a small generator script. No third-party artwork — illustrations, anatomy charts,
  icons or other apps' body maps — was traced, copied or adapted.
- **Who:** made with an AI coding assistant under the direction of the project owner.
- **Source file:** `tools/bodymap/gen.py`. Running `python3 tools/bodymap/gen.py` regenerates the path data
  in `src/ui/bodymap-art.js` (do not edit that file by hand); `--preview DIR` also writes a preview page and
  standalone SVGs for review. Colours are not part of the artwork; they come from the tokens in `app.css`.

The UI icons are not original work: they come from Lucide and Tabler Icons under their licences
(`THIRD-PARTY-NOTICES.md`), except the nine below.

# Authorship of the hand-portion and cooking icons

- **What:** `hand-palm`, `hand-fist`, `hand-thumb` (hand portions) and `cook-steam`, `cook-pan`, `cook-fry`
  (cooking methods) in `src/ui/icons.js`, used by "Estimate a meal" (`src/food/estimate.js`).
- **When:** drawn for this project on 2026-11-27 (design demo approved by the project owner).
- **How:** hand-written SVG paths on the Lucide grid (24 × 24, stroke 2, round caps and joins, no fill) so they
  match the other icons. No third-party icon or artwork was traced, copied or adapted.
- **Who:** made with an AI coding assistant under the direction of the project owner.

# Authorship of the plate icons

- **What:** `plate-s`, `plate-m`, `plate-l` (small / normal / large dish portion: two plate rims of growing size) in
  `src/ui/icons.js`, used by the portion sheet of a dish (`src/food/portion.js`).
- **When:** drawn for this project on 2026-11-27 (eat-out design demo approved by the project owner).
- **How:** hand-written SVG circles on the Lucide grid (24 × 24, stroke 2, no fill). No third-party icon or artwork
  was traced, copied or adapted.
- **Who:** made with an AI coding assistant under the direction of the project owner.
