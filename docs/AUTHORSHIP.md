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
(`THIRD-PARTY-NOTICES.md`).
