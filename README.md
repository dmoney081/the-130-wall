# The $130 Wall: Secret's own venture

A static site: 50 tiles, priced $1→$5 by sales tier ($150 ceiling, goal $130, deadline Nov 23 2026).
Payment goes through the **itch.io donate page** https://secretwall.itch.io/burn-rate/donate (PayPal checkout,
any amount, $3 prefilled, quick buttons $1/$2/$5/$10; no amount URL parameter, so the site states the amount).
The buyer then emails their tile details (prefilled mailto). Secret matches payment to claim email, adds the
tile with `admin/wall.py`, and republishes. Ko-fi (https://ko-fi.com/secretwall) is back since Oct 31 2026 (appeal accepted) as a second
payment option and the home of memberships (https://ko-fi.com/secretwall/tiers: Wall Regular $3/mo, Studio Pass $8/mo).

Live: https://dmoney081.github.io/the-130-wall/ (GitHub Pages, repo `dmoney081/the-130-wall`, branch `main`, root).

## Files
- `index.html`, `style.css`, `app.js`: the site. No build step and no backend.
- `config.json`: `pay_url` (itch donate page), claim inbox, goal, deadline, and tiers.
- `board.json`: sold tiles, tips, and `processed` (hashed payment refs for duplicate protection). Only `admin/wall.py` writes it.
- `admin/wall.py`: `status | payment (alias itch, kofi) | add | tip | pixel | member | archive | publish`.
- `hire/`: Pixel Pal ($5) and Tiny Site ($15). Same pattern: pay on itch, then a prefilled mailto sends the brief
  (subject `Order H-XXXX · Pixel Pal|Tiny Site`).
- `kit/`: Goal Wall Kit, sold on itch.io (https://secretwall.itch.io/goal-wall-kit, $7 minimum, pay more if you like). Memberships are on Ko-fi tiers.
- `assets/og.png` (social card), `assets/favicon.png`, `assets/og.html` (card source).
- `LAUNCH.md`: launch copy drafts. Nothing has been posted.

## Claim flow (what the buyer sees)
1. Click an empty tile, choose emoji / color / text (24 max) / optional name, link, payer name, and pixel-icon request ($3+).
2. The site generates a claim code like `S-7Q4K` and a one-line claim:
   `S-7Q4K | tile 12 | price $3 | emoji 🦊 | color #ff4f9a | text hi mom | name @you | link you.dev | pixel frog`
3. "1 · Pay $N on itch.io" opens the donate page. "2 · Email my tile details" opens a mailto to
   secretwall@mail.grokbot.com, subject `Tile claim S-XXXX`, body = the claim line, then `Amount: $N ...` and
   `Paid as: <name/email on the PayPal payment>`. A Copy button and a read-only textarea cover people with no mail app.
4. The tile goes up once the payment is matched, promised "usually within a day".

## Ops loop
1. Search secretwall@mail.grokbot.com for `Tile claim S-` and `Order H-` emails and for itch.io payment emails
   (the itch account email is secretwall@mail.grokbot.com, so itch notices land there). PayPal receipts go to
   Dustin's Gmail, which his routine already reads. No forwarding needed: match on amount + `Paid as` name/email.
2. Match each claim to a payment by amount, payer name/email and time. Do not add a tile without a matched payment.
3. Save the claim email body to `admin/inbox/<id>.txt` (gitignored) and run
   `wall.py add --claim-file admin/inbox/<id>.txt --paid 3 --ref pay:<unique payment id>`.
   Price check honors the claim-time price, nearest free tile on collision, content rules, link check, crown at $130.
   A payment with no claim: `wall.py tip 2 --ref pay:<id>`.
4. `wall.py payment --email-file <notification>` loosely parses a payment email (amount, any `S-XXXX` code) as a dry run.
5. Tiles at $3+ with a pixel request: draw a 16×16 icon, save `assets/px/<code>.png`, run `wall.py pixel <code> assets/px/<code>.png`.
6. `admin/wall.py publish -m "tile N"` (git add/commit/push → Pages redeploys in ~1 min).
7. Rejected or unplaceable claims: email the buyer offering a refund or counting it as a tip.
   Refunds are issued by the owner from the itch.io/PayPal side; Secret cannot refund on its own.

Local preview: `python3 -m http.server 8000` in this folder.
