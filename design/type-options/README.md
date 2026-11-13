# Font and slogan options

This is a self-contained local design comparison, with three licensed font subsets and three switchable slogans. It does not modify the live home/login pages or send credentials. Full login-page samples disable form fields and block form submission with CSP.

User selection: **A / Fusion Bold Pixel** with **一起上线，一起造。** The original comparison is retained as design history.

| Option | Typeface | Original source |
| --- | --- | --- |
| A | Fusion Bold Pixel 12px proportional zh-Hans, 2026.11.10 | https://github.com/pixel-font-studio/fusion-bold-pixel-font/releases/tag/2026.11.10 |
| B | Smiley Sans Oblique, v2.0.1 | https://github.com/atelier-anchor/smiley-sans/releases/tag/v2.0.1 |
| C | ZCOOL QingKe HuangYou Regular | https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou |

The font subsets are renamed Joincraft Candidate Fusion/Smiley/Butter and retain their original copyright and license metadata. SIL OFL and component notices are in fonts/.

The build embeds fonts and the approved scene directly into each HTML file. Open index.html in a browser or use the local preview at http://127.0.0.1:4213/. The three linked HTML files show the full login layout. There are no external font/image dependencies or account requests.

Slogans: 开个世界，叫上朋友。 / 你的世界，叫上朋友。 / 一起上线，一起造。

Rebuild comparison HTML with node design/type-options/build.mjs. For font regeneration, use fontTools[woff] and build-fonts.py after downloading the pinned original releases into /tmp/joincraft-type-candidates/.
