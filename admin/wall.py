#!/usr/bin/env python3
"""Ops CLI for the Wall. Payments go through the itch.io donate page (https://secretwall.itch.io/burn-rate/donate,
PayPal checkout). Buyers pay the tile price there, then email their claim (subject "Tile claim S-XXXX", first line
is the one-line claim) to secretwall@mail.grokbot.com. Match the payment notification to the claim email, then `add`.
(Ko-fi was the old checkout; it is offline. The `kofi` subcommand name is kept as an alias of `payment`.)

  wall.py status
  wall.py payment --email-file mail.txt [--apply]        # parse a payment notification email; dry run unless --apply
  wall.py add --claim-file claim.txt --paid 3            # claim text = claim email body (first line is the claim)
  wall.py add --pos 12 --emoji 🐸 --color '#33ff99' --text 'hi mom' --handle @x --link x.com --paid 1 --code S-ABCD
  wall.py tip 2.50
  wall.py pixel S-ABCD assets/px/S-ABCD.png              # attach the custom pixel icon to a tile
  wall.py member --pos 7 --emoji 🌙 --text 'hi' --handle @x   # member perk tile: paid 0, never counts toward the total
  wall.py archive --theme 'Spooky pixels' [--month 2026-11]  # copy board.json to boards/<month>.json, start a fresh board
  wall.py --board boards/2026-10.json status             # any command can target another board file
  wall.py publish                                        # git add/commit/push (only after owner approves hosting)
"""
import argparse, json, re, subprocess, sys, datetime, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT/'config.json').read_text())
BOARD_P = ROOT/'board.json'
N = CFG['cols'] * CFG['rows']
BLOCK = re.compile(r'(https?://|www\.|\.com\b|nigg|fag|retard|kike|porn|onlyfans|nazi|kill yourself|kys)', re.I)

def load(): return json.loads(BOARD_P.read_text())
def paid_tiles(b): return [t for t in b['tiles'] if not t.get('member')]
def save(b):
    b['updated'] = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
    BOARD_P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n')
def price_at(k): return CFG['tier_prices'][min(k // CFG['tier_size'], len(CFG['tier_prices']) - 1)]
def raised(b): return sum(float(t['paid']) for t in paid_tiles(b)) + float(b.get('tips_usd', 0))  # member tiles never count

CODE_RE = re.compile(r'\bS-[A-HJ-NP-Z2-9]{4}\b', re.I)
KEYS = r'(CLAIM|code|tile|price|emoji|color|text|handle|name|link|pixel)'

def parse_claim(txt):
    """Parse a claim. Accepts the site's one-line claim format
         S-7Q4K | tile 12 | price $3 | emoji 🦊 | color #ff4f9a | text hi mom | name @you | link x.com | pixel frog
       and the older multi-line `key: value` format. Unknown chunks are ignored."""
    d = {}
    for chunk in re.split(r'\s*\|\s*|\r?\n', txt):
        m = re.match(r'\s*' + KEYS + r'\b\s*:?\s*(.*)$', chunk, re.I)
        if m and m.group(2).strip(): d[m.group(1).lower()] = m.group(2).strip()
    if 'claim' in d: d['code'] = d.pop('claim')
    if 'name' in d and 'handle' not in d: d['handle'] = d.pop('name')
    m = CODE_RE.search(d.get('code', '')) or CODE_RE.search(txt)
    if m: d['code'] = m.group(0).upper()
    else: d.pop('code', None)
    return d

def clean_link(u):
    """Return a normalized https link or '' (rejected). Links show only in the ledger, rel=nofollow."""
    u = (u or '').strip()
    if not u: return ''
    if not re.match(r'https?://', u, re.I): u = 'https://' + u
    if len(u) > 100 or not re.fullmatch(r'https?://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"\']*)?', u): return ''
    if re.search(r'(porn|onlyfans|xxx|casino|bet|crypto-?giveaway|bit\.ly|tinyurl)', u, re.I): return ''
    return u

def nearest_free(b, want):
    taken = {t['pos'] for t in b['tiles']}
    if want not in taken: return want
    cols = CFG['cols']; wr, wc = divmod(want, cols)
    free = [p for p in range(N) if p not in taken]
    return min(free, key=lambda p: abs(p // cols - wr) + abs(p % cols - wc)) if free else None

def cmd_status(a):
    b = load(); k = len(paid_tiles(b)); m = len(b['tiles']) - k
    print(f"[{BOARD_P.name}] month {b.get('month','?')} theme {b.get('theme','')!r}")
    print(f"raised ${raised(b):.2f} / ${CFG['goal_usd']} | paid tiles {k}, member tiles {m}, {len(b['tiles'])}/{N} used | next price ${price_at(k) if len(b['tiles']) < N else '-'} | tips ${b.get('tips_usd',0)}")
    for t in b['tiles']: print(f"  #{t['pos']+1:>2} {t.get('emoji','')} {t.get('text','')!r} {t.get('handle','')} ${t['paid']} {'MEMBER' if t.get('member') else t.get('code','')}")

def cmd_member(a):
    b = load()
    if len(b['tiles']) >= N: sys.exit('wall is full')
    text = (a.text or '')[:24]; handle = (a.handle or '')[:30]
    if BLOCK.search(text + ' ' + handle): sys.exit('rejected by content rules')
    color = a.color if a.color and re.fullmatch(r'#[0-9a-fA-F]{6}', a.color) else '#9b7bff'
    want = (a.pos - 1) if a.pos else N - 1
    p = nearest_free(b, max(0, min(N - 1, want)))
    before = raised(b)
    b['tiles'].append({'pos': p, 'emoji': (a.emoji or '★')[:8], 'color': color, 'text': text, 'handle': handle,
        'paid': 0, 'member': True, 'ts': datetime.datetime.now().astimezone().isoformat(timespec='seconds')})
    save(b); assert raised(b) == before
    print(f'member tile #{p+1} added; raised unchanged at ${before:.2f}')

def cmd_archive(a):
    b = load()
    month = a.month or b.get('month') or datetime.date.today().strftime('%Y-%m')
    if not re.fullmatch(r'\d{4}-\d{2}', month): sys.exit('month must be YYYY-MM')
    dst = ROOT/'boards'/f'{month}.json'
    if dst.exists() and not a.force: sys.exit(f'{dst} exists (use --force)')
    dst.parent.mkdir(exist_ok=True); b['month'] = month; b['archived'] = True
    dst.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n')
    y, mo = map(int, month.split('-')); nxt = a.next or f'{y + mo // 12}-{mo % 12 + 1:02d}'
    idx = ROOT/'boards'/'index.json'
    months = sorted(set((json.loads(idx.read_text()) if idx.exists() else []) + [month]))
    idx.write_text(json.dumps(months) + '\n')
    save({'month': nxt, 'theme': a.theme, 'updated': '', 'tips_usd': 0, 'tiles': []})
    print(f'archived {month} -> {dst.relative_to(ROOT)} (raised ${raised(b):.2f}); new board {nxt} theme {a.theme!r}')

def cmd_add(a):
    b = load(); k = len(paid_tiles(b))
    if len(b['tiles']) >= N: sys.exit('wall is full')
    d = parse_claim(pathlib.Path(a.claim_file).read_text()) if a.claim_file else {}
    for f in ('emoji','color','text','handle','code','pixel','link','tile','price'):
        v = getattr(a, f, None)
        if v is not None: d[f] = v
    if a.pos is not None: pos = a.pos if a.zero else a.pos - 1
    else: pos = int(re.sub(r'\D', '', d.get('tile', '1')) or 1) - 1
    price = price_at(k)
    # Honor the price the site showed at claim time (tiers can move between tip and processing),
    # but never below the first-tier price.
    claimed = re.sub(r'[^\d.]', '', d.get('price', '')) or ''
    need = price
    if claimed:
        try: need = max(CFG['tier_prices'][0], min(price, float(claimed)))
        except ValueError: pass
        if need < price: print(f'note: honoring claim-time price ${need:g} (current tier is ${price})')
    if a.paid + 1e-9 < need: sys.exit(f'underpaid: paid ${a.paid}, price ${need:g}. Ask them to top up, or count it as a tip / refund.')
    if any(t.get('code') == d.get('code') for t in b['tiles'] if d.get('code')): sys.exit('code already used')
    if getattr(a, 'ref', None) and a.ref in b.get('processed', []): sys.exit('payment already processed')
    text = (d.get('text') or '')[:24]; handle = (d.get('handle') or '')[:30]
    if BLOCK.search(text + ' ' + handle): sys.exit('rejected by content rules -> offer refund (or count as tip)')
    link = clean_link(d.get('link'))
    if d.get('link') and not link: print(f'note: link {d.get("link")!r} rejected; tile added without it')
    color = d.get('color') or '#ff4f9a'
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): color = '#ff4f9a'
    p = nearest_free(b, max(0, min(N - 1, pos)))
    before = raised(b)
    t = {'pos': p, 'emoji': (d.get('emoji') or '■')[:8], 'color': color, 'text': text, 'handle': handle,
         'paid': round(a.paid, 2), 'code': d.get('code', ''), 'ts': datetime.datetime.now().astimezone().isoformat(timespec='seconds')}
    if link: t['link'] = link
    if d.get('pixel') and a.paid + 1e-9 >= 3: t['pixel_request'] = d['pixel'][:60]
    if getattr(a, 'ref', None): b.setdefault('processed', []).append(a.ref)
    if before < CFG['goal_usd'] <= before + a.paid: t['crown'] = True
    b['tiles'].append(t); save(b)
    moved = '' if p == pos else f' (requested #{pos+1} was taken)'
    print(f'added tile #{p+1}{moved}; raised now ${raised(b):.2f}' + (' -- GOAL CROSSED, crown awarded' if t.get('crown') else ''))

def cmd_tip(a):
    b = load()
    if getattr(a, 'ref', None):
        if a.ref in b.get('processed', []): sys.exit('already processed')
        b.setdefault('processed', []).append(a.ref)
    before = raised(b); b['tips_usd'] = round(float(b.get('tips_usd', 0)) + a.amount, 2); save(b)
    print(f'tips now ${b["tips_usd"]}; raised ${raised(b):.2f}' + (' -- GOAL CROSSED by a tip' if before < CFG['goal_usd'] <= raised(b) else ''))

def cmd_pixel(a):
    b = load()
    for t in b['tiles']:
        if t.get('code') == a.code: t['pixel'] = a.path; save(b); print('attached'); return
    sys.exit('no tile with that code')

# ---- payment notification emails (itch.io/PayPal now; Ko-fi before) -------------------------------------------------------------------------
# The exact format of the itch.io/PayPal "you received a donation" email is UNKNOWN until the first real one arrives at
# secretwall@mail.grokbot.com. This parser is deliberately loose: it pulls the first USD amount, any claim
# code (S-XXXX), and the message text, and always prints what it found. When the first real email
# arrives, save it to admin/samples/ (strip the supporter's email address first), check the dry run, and
# tighten AMOUNT_RES / MSG_RES below if needed.
AMOUNT_RES = [
    re.compile(r'(?:sent you|tipped you|bought you|received|donation of|tip of|amount)[^$\d]{0,40}\$\s?(\d+(?:\.\d{1,2})?)', re.I),
    re.compile(r'\$\s?(\d+(?:\.\d{1,2})?)(?:\s*USD)?'),
    re.compile(r'(\d+(?:\.\d{1,2})?)\s*USD', re.I),
]
MSG_RES = [
    re.compile(r'(?:message|they said|wrote|note)\s*[:\-]?\s*["\u201c]?(.+?)["\u201d]?\s*$', re.I | re.M),
]

def email_text(raw):
    """Plain text from a raw .eml (MIME) or from already-extracted text/HTML."""
    import email, html
    if re.match(r'^[A-Za-z-]+: ', raw) and '\n\n' in raw:
        msg = email.message_from_bytes(raw.encode('utf-8', 'surrogateescape'))
        parts = []
        for part in (msg.walk() if msg.is_multipart() else [msg]):
            if part.get_content_type() in ('text/plain', 'text/html'):
                pl = part.get_payload(decode=True)
                if pl: parts.append((part.get_content_type(), pl.decode(part.get_content_charset() or 'utf-8', 'replace')))
        plain = [t for c, t in parts if c == 'text/plain']
        raw = (plain or [t for _, t in parts] or [raw])[0]
        subj = msg.get('Subject', ''); mid = msg.get('Message-ID', '')
        raw = f'Subject: {subj}\nMessage-ID: {mid}\n' + raw
    if '<' in raw and '>' in raw:
        raw = re.sub(r'(?is)<(script|style).*?</\1>', ' ', raw)
        raw = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</tr>', '\n', raw)
        raw = html.unescape(re.sub(r'<[^>]+>', ' ', raw))
    return re.sub(r'[ \t]+', ' ', raw)

def parse_payment(raw):
    import hashlib
    txt = email_text(raw)
    out = {'amount': None, 'code': None, 'message': '', 'claim': {}, 'ref': None, 'warnings': []}
    for rx in AMOUNT_RES:
        m = rx.search(txt)
        if m: out['amount'] = float(m.group(1)); break
    if out['amount'] is None: out['warnings'].append('no amount found')
    if re.search(r'\b(EUR|GBP|CAD|AUD|€|£)\b', txt): out['warnings'].append('non-USD currency mentioned; check the amount by hand')
    if re.search(r'\b(monthly|membership|subscription|shop order|commission)\b', txt, re.I): out['warnings'].append('may not be a one-time tip; check by hand')
    cm = CODE_RE.search(txt)
    if cm:
        out['code'] = cm.group(0).upper()
        line = next((l for l in txt.splitlines() if cm.group(0) in l), '')
        out['message'] = line.strip()
        out['claim'] = parse_claim(line)
    else:
        for rx in MSG_RES:
            m = rx.search(txt)
            if m: out['message'] = m.group(1).strip()[:300]; break
    mid = re.search(r'Message-ID:\s*(\S+)', txt, re.I)
    tx = re.search(r'(?:transaction|reference|txn)[^A-Za-z0-9]{0,5}([A-Za-z0-9-]{8,})', txt, re.I)
    basis = (mid.group(1) if mid else '') or (tx.group(1) if tx else '') or txt
    out['ref'] = 'pay:' + hashlib.sha256(basis.encode()).hexdigest()[:16]
    return out

def cmd_payment(a):
    raw = pathlib.Path(a.email_file).read_text(errors='replace')
    r = parse_payment(raw)
    print(json.dumps({k: v for k, v in r.items()}, ensure_ascii=False, indent=2))
    b = load()
    if r['ref'] in b.get('processed', []): sys.exit('already processed (duplicate email)')
    if r['amount'] is None or r['warnings'] and not a.force:
        sys.exit('needs a human look (see warnings); rerun with explicit `add`/`tip`, or --force')
    if not a.apply:
        print('dry run: would ' + (f"add tile for {r['code']} paid ${r['amount']}" if r['code'] else f"record tip ${r['amount']}") + ' (pass --apply)')
        return
    if r['code']:
        ns = argparse.Namespace(claim_file=None, pos=None, zero=False, paid=r['amount'], ref=r['ref'],
                                **{f: r['claim'].get(f) for f in ('emoji','color','text','handle','pixel','link')}, code=r['code'])
        ns.tile = r['claim'].get('tile'); ns.price = r['claim'].get('price')
        cmd_add(ns)
    else:
        cmd_tip(argparse.Namespace(amount=r['amount'], ref=r['ref']))

def cmd_publish(a):
    subprocess.run(['git', '-C', str(ROOT), 'add', '-A'], check=True)
    subprocess.run(['git', '-C', str(ROOT), 'commit', '-m', a.msg or 'wall update'], check=False)
    subprocess.run(['git', '-C', str(ROOT), 'push'], check=True)

ap = argparse.ArgumentParser(); ap.add_argument('--board', help='board file (default board.json)'); sp = ap.add_subparsers(dest='cmd', required=True)
sp.add_parser('status').set_defaults(f=cmd_status)
x = sp.add_parser('add'); x.set_defaults(f=cmd_add)
x.add_argument('--claim-file'); x.add_argument('--pos', type=int); x.add_argument('--zero', action='store_true', help='--pos is 0-based')
for f in ('emoji','color','text','handle','code','pixel','link'): x.add_argument('--'+f)
x.add_argument('--paid', type=float, required=True); x.add_argument('--ref', help='payment reference, for duplicate protection')
x = sp.add_parser('tip'); x.add_argument('amount', type=float); x.add_argument('--ref'); x.set_defaults(f=cmd_tip)
x = sp.add_parser('payment', aliases=['itch', 'kofi'], help='parse one payment notification email'); x.set_defaults(f=cmd_payment)
x.add_argument('--email-file', required=True); x.add_argument('--apply', action='store_true'); x.add_argument('--force', action='store_true')
x = sp.add_parser('pixel'); x.add_argument('code'); x.add_argument('path'); x.set_defaults(f=cmd_pixel)
x = sp.add_parser('member', help='add a member perk tile (paid 0, not counted)'); x.set_defaults(f=cmd_member)
x.add_argument('--pos', type=int, help='1-based'); [x.add_argument('--'+f) for f in ('emoji','color','text','handle')]
x = sp.add_parser('archive', help='freeze board to boards/YYYY-MM.json and start a fresh one'); x.set_defaults(f=cmd_archive)
x.add_argument('--theme', required=True); x.add_argument('--month'); x.add_argument('--next'); x.add_argument('--force', action='store_true')
x = sp.add_parser('publish'); x.add_argument('-m', '--msg'); x.set_defaults(f=cmd_publish)
a = ap.parse_args()
if a.board:
    BOARD_P = pathlib.Path(a.board)
    if not BOARD_P.is_absolute(): BOARD_P = (pathlib.Path.cwd()/BOARD_P) if BOARD_P.exists() else ROOT/BOARD_P
a.f(a)
