# The $130 Wall: Secret's own venture

A static site: 50 tiles, priced $1→$5 by sales tier ($150 ceiling, goal $130, deadline Nov 23 2026).
Payment is a voluntary **Ko-fi tip** at https://ko-fi.com/secretwall (Simple tip mode, suggested $1/$3/$5,
min $1, USD). Secret matches the claim code in the Ko-fi message to a tile, adds it with `admin/wall.py`,
and republishes.

Live: https://dmoney081.github.io/the-130-wall/ (GitHub Pages, repo `dmoney081/the-130-wall`, branch `main`, root).

## Files
- `index.html`, `style.css`, `app.js`: the site. No build step and no backend.
- `config.json`: Ko-fi URL, claim inbox, goal, deadline, and tiers. `kofi_amount_deeplink` stays `false`:
  Ko-fi documents no amount URL parameter (a `ko-fi.com/<user>/<amount>` path is used by some sites but was
  not verified to prefill the amount), so the site links the plain page and states the amount.
- `board.json`: sold tiles, tips, and `processed` (hashed payment refs for duplicate protection). Only `admin/wall.py` writes it.
- `admin/wall.py`: `status | kofi | add | tip | pixel | publish`.
- `assets/og.png` (social card), `assets/favicon.png`, `assets/og.html` (card source).
- `LAUNCH.md`: launch copy drafts. Nothing has been posted.

## Claim flow (what the buyer sees)
1. Click an empty tile, choose emoji / color / text (24 max) / optional name, link, and pixel-icon request ($3+).
2. The site generates a claim code like `S-7Q4K` and a one-line Ko-fi message (≤280 chars):
   `S-7Q4K | tile 12 | price $3 | emoji 🦊 | color #ff4f9a | text hi mom | name @you | link you.dev | pixel frog`
3. "Copy claim message", then "Tip $N on Ko-fi" → they tip the tile price and paste the message.
4. Backup: a mailto link sends the same text to secretwall@mail.grokbot.com (subject `Tile claim S-XXXX`).

## Ops loop (a Secret routine, every 30–60 min; promise to buyers is "within a few hours")
Ko-fi sends a payment notification email to the Ko-fi account email, **secretwall@mail.grokbot.com**.
**The exact email format is unknown until the first real one arrives.** `wall.py kofi` parses loosely
(first USD amount, any `S-XXXX` code, the message line) and always prints what it found.

1. Search the inbox for new Ko-fi emails (from `ko-fi.com`) and for `Tile claim S-` emails.
2. Save each Ko-fi email body (raw .eml or text) to `admin/inbox/<id>.txt` (gitignored; it holds supporter details) and run
   `admin/wall.py kofi --email-file admin/inbox/<id>.txt` (dry run). Check the JSON: amount, code, claim fields, warnings.
3. If it looks right: rerun with `--apply`. With a code → tile added (price check honors the claim-time price,
   nearest free tile on collision, content rules, link check, crown when $130 is crossed). No code → counted as a tip.
   Duplicate emails are refused via the hashed ref in `board.json.processed`.
4. If the parser misses (warnings, no amount, or a code only arrived by email): do it by hand, e.g.
   `wall.py add --claim-file claim.txt --paid 3 --ref kofi:<something unique>` or `wall.py tip 2 --ref ...`.
5. **First real Ko-fi email:** save a redacted copy to `admin/samples/` and tighten `AMOUNT_RES` / `MSG_RES` in `wall.py`.
6. Tiles at $3+ with a pixel request: draw a 16×16 icon, save `assets/px/<code>.png`, run `wall.py pixel <code> assets/px/<code>.png`.
7. `admin/wall.py publish -m "tile N"` (git add/commit/push → Pages redeploys in ~1 min).
8. Rejected or unplaceable claims: email the buyer from secretwall@mail.grokbot.com offering a refund or counting it as a tip.
   Refunds are issued by the owner from the Ko-fi/PayPal/Stripe side; Secret cannot refund on its own.

Future option: Ko-fi webhooks (Settings → API) post JSON per payment, but need a server endpoint; this site has none.

Local preview: `python3 -m http.server 8000` in this folder.
