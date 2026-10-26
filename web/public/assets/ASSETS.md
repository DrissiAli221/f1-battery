# Asset sources

- Felt texture: ambientCG Fabric034 (https://ambientcg.com/view?id=Fabric034), CC0. Downscaled to 768 px and greyscaled in assets/felt-grey.jpg; tinted and tiled in CSS.
- Black Felt: E. van Zummeren, Subtle Patterns. Download served by Transparent Textures. Original: https://www.toptal.com/designers/subtlepatterns/black-felt/ . CC BY-SA 3.0, as documented at https://github.com/atlemo/SubtlePatterns . The original bitmap is retained unmodified in assets/black-felt.png; visual adjustment is CSS only.
  Attribution: "Black Felt" by E. van Zummeren (Subtle Patterns), https://www.toptal.com/designers/subtlepatterns/black-felt/ , licensed CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). Kept in git.
- Hover reference and pixel mask: https://heronaiapp.com/ and https://heronai-bp.netlify.app/assets/pixel-mask.svg . Original mask retained for this private local reference study. Animation code is newly written. No redistribution licence inferred from public availability. **Not in git; private S3, private non-commercial use** (assets/heron-pixel-mask.svg).
- Video frames: supplied by Ali as heronaiapp-a814d6.mp4, extracted at original frame rate and cropped to the button for local comparison.
- Typeface files: official Formula 1-hosted Formula1 Black and KH Interference; Vercel Geist and Geist Mono. Private study only; see page footer. **Not in git; private S3, private non-commercial use:** fonts/Formula1-Black.woff2, fonts/KHInterference-Regular.woff2, fonts/KHInterferenceF1-Regular.woff2. Geist, Geist Mono, Archivo and Titillium Web are OFL and stay in git.
- Hero and share images: F1 "digital presentation" wallpaper (D31), compressed as hero.jpg, hero.webp, hero-1280.webp and og.png under web/public/. **Not in git; private S3, private non-commercial use.** Copyright F1/FOM.

## Private assets

The files marked not in git are listed in web/private-assets.txt and ignored by web/.gitignore. `web/scripts/private-assets.sh push` uploads them to `s3://$F1_S3_BUCKET/private-assets/`; `pull` downloads them into place before a production build. Without them the site builds with the Archivo and Geist Mono fallbacks.
