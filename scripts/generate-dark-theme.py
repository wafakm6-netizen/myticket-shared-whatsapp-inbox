#!/usr/bin/env python3
"""Generate app/dark-theme.css from the light stylesheets.

Every rule in app/globals.css and app/new-conversation.css that sets a colour
(text, background or border) gets a dark-mode twin, scoped to
html[data-theme="dark"] so it out-ranks the original. Light surfaces become dark
slate, dark text becomes light, and saturated brand colours (orange, green,
blue, red) are kept. Colours set in inline styles in the TSX files get
attribute-selector rules. Re-run after changing colours in the stylesheets:

    python3 scripts/generate-dark-theme.py
"""
import colorsys, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = [ROOT / 'app/globals.css', ROOT / 'app/new-conversation.css']
OUT = ROOT / 'app/dark-theme.css'
SCOPE = 'html[data-theme="dark"]'

COLOR_PROPS = {'color', 'background', 'background-color', 'border', 'border-color', 'border-top', 'border-right',
               'border-bottom', 'border-left', 'border-top-color', 'border-right-color', 'border-bottom-color',
               'border-left-color', 'outline', 'outline-color', 'fill', 'stroke', 'caret-color', 'border-inline-start',
               'border-inline-end', 'border-block-start', 'border-block-end'}
COLOR_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b')


def parse_color(token):
    t = token.lower()
    if t == 'white': return (255, 255, 255, 1.0)
    if t == 'black': return (0, 0, 0, 1.0)
    if t.startswith('#'):
        h = t[1:]
        if len(h) in (3, 4): h = ''.join(c * 2 for c in h)
        if len(h) not in (6, 8): return None
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (r, g, b, a)
    m = re.match(r'rgba?\(([^)]*)\)', t)
    if not m: return None
    parts = [p.strip() for p in re.split(r'[,\s/]+', m.group(1)) if p.strip()]
    if len(parts) < 3: return None
    try:
        r, g, b = [float(p.rstrip('%')) for p in parts[:3]]
        a = float(parts[3]) if len(parts) > 3 else 1.0
        if parts[3:] and parts[3].endswith('%'): a = float(parts[3][:-1]) / 100
    except ValueError:
        return None
    return (int(r), int(g), int(b), a)


def fmt(r, g, b, a):
    r, g, b = [max(0, min(255, int(round(v)))) for v in (r, g, b)]
    return f'#{r:02x}{g:02x}{b:02x}' if a >= 0.999 else f'rgba({r},{g},{b},{round(a, 3)})'


def hsl(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h, s, l


def from_hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return r * 255, g * 255, b * 255


SLATE_H = 213 / 360


def map_surface(c):
    """Backgrounds and borders: light -> dark, saturated brand colours kept."""
    r, g, b, a = c
    h, s, l = hsl(r, g, b)
    if l >= 0.86:
        if s < 0.3 or l > 0.985:
            # White and near-white greys: layered dark slate panels.
            nl = 0.105 + (1 - l) * 0.55
            return fmt(*from_hsl(SLATE_H, 0.24, min(nl, 0.2)), a)
        # Pale tints (peach, mint, blue, yellow): same hue, dark and muted.
        return fmt(*from_hsl(h, min(s, 0.45), 0.17), a)
    if l >= 0.62 and s < 0.35:
        # Light grey borders and dividers.
        return fmt(*from_hsl(SLATE_H, 0.2, 0.24), a)
    return None


def map_text(c):
    """Text: dark slate -> light, muted grey -> light muted, brand colours kept."""
    r, g, b, a = c
    h, s, l = hsl(r, g, b)
    if l >= 0.86:
        return None  # already light (white text on coloured buttons)
    if s < 0.5 and l < 0.45:
        return fmt(*from_hsl(h, min(s, 0.2), 0.9 - l * 0.35), a)
    if s < 0.35 and l < 0.75:
        return fmt(*from_hsl(h, min(s, 0.15), 0.66), a)
    if l < 0.3:
        return fmt(*from_hsl(h, min(s, 0.7), 0.76), a)
    return None


def map_value(prop, value):
    surface = prop != 'color' and prop != 'caret-color'
    changed = False

    def repl(m):
        nonlocal changed
        c = parse_color(m.group(0))
        if not c: return m.group(0)
        out = map_surface(c) if surface else map_text(c)
        if out is None: return m.group(0)
        changed = True
        return out

    if 'url(' in value:
        return None
    new = COLOR_RE.sub(repl, value)
    return new if changed else None


def split_top(s, sep):
    parts, depth, cur = [], 0, ''
    for ch in s:
        if ch in '([': depth += 1
        elif ch in ')]': depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += ch
    parts.append(cur)
    return parts


def scope_selector(sel):
    sel = sel.strip()
    if not sel: return None
    if sel.startswith('html'):
        return SCOPE + sel[4:]
    if sel.startswith(':root'):
        return SCOPE + sel[5:]
    return f'{SCOPE} {sel}'


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def parse_blocks(css):
    """Yield (prelude, body) for top-level blocks."""
    i, n = 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0: break
        # Drop statements without a block (e.g. @import …;) that precede this rule.
        prelude = css[i:j].rsplit(';', 1)[-1].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if css[k] == '{': depth += 1
            elif css[k] == '}': depth -= 1
            k += 1
        yield prelude, css[j + 1:k - 1]
        i = k


def convert_rules(css):
    out = []
    for prelude, body in parse_blocks(css):
        if prelude.startswith('@media') or prelude.startswith('@supports'):
            inner = convert_rules(body)
            if inner: out.append(f'{prelude}{{{"".join(inner)}}}')
            continue
        if prelude.startswith('@'):
            continue
        decls = []
        for decl in split_top(body, ';'):
            if ':' not in decl: continue
            prop, val = decl.split(':', 1)
            prop = prop.strip().lower()
            if prop.startswith('--'):
                # Colour variables (--line, --paper, --ink…): pale ones are surfaces, dark greys are text.
                v = val.replace('!important', '').strip()
                c = parse_color(v) if COLOR_RE.fullmatch(v) else None
                if not c: continue
                l = hsl(*c[:3])[2]
                if any(k in prop for k in ('line', 'border')):
                    mapped = fmt(*from_hsl(SLATE_H, 0.2, 0.22), c[3]) if l >= 0.62 else None
                else:
                    mapped = map_surface(c) if l >= 0.62 else map_text(c)
                if mapped: decls.append(f'{prop}:{mapped}')
                continue
            if prop not in COLOR_PROPS: continue
            important = '!important' in val
            val = val.replace('!important', '').strip()
            if not val: continue
            # Every colour declaration gets a twin (mapped or unchanged) so later light-mode overrides
            # still win over earlier ones in dark mode, exactly as in the original cascade.
            decls.append(f'{prop}:{map_value(prop, val) or val}' + ('!important' if important else ''))
        if not decls: continue
        sels = [scope_selector(s) for s in split_top(prelude, ',')]
        sels = [s for s in sels if s]
        if sels: out.append(f'{",".join(sels)}{{{";".join(decls)}}}')
    return out


def inline_rules():
    """Inline style colours in TSX (React serialises them as rgb())."""
    colors = set()
    for f in list((ROOT / 'app').rglob('*.tsx')) + list((ROOT / 'components').rglob('*.tsx')):
        for m in re.finditer(r"(?:color|background|backgroundColor|border)\s*:\s*['\"]([^'\"]+)['\"]", f.read_text()):
            for c in COLOR_RE.findall(m.group(1)):
                colors.add(c)
    out = []
    for token in sorted(colors):
        c = parse_color(token)
        if not c or c[3] < 0.999: continue
        rgb = f'rgb({c[0]}, {c[1]}, {c[2]})'
        bg = map_surface(c); tx = map_text(c)
        if bg:
            out.append(f'{SCOPE} [style*="background: {rgb}"],{SCOPE} [style*="background-color: {rgb}"]{{background:{bg}!important}}')
            out.append(f'{SCOPE} [style*="solid {rgb}"]{{border-color:{bg}!important}}')
        if tx:
            out.append(f'{SCOPE} [style^="color: {rgb}"],{SCOPE} [style*="; color: {rgb}"]{{color:{tx}!important}}')
    return out


def main():
    parts = ['/* Generated by scripts/generate-dark-theme.py — do not edit by hand; put hand-tuned dark styles in app/dark-theme-overrides.css. */']
    for src in SOURCES:
        parts.extend(convert_rules(strip_comments(src.read_text())))
    parts.extend(inline_rules())
    OUT.write_text('\n'.join(parts) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}: {len(parts)} rules, {OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
