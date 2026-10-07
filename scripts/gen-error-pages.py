#!/usr/bin/env python3
"""Builds the static error pages served by nginx (nginx/errors/api and nginx/errors/panel).

The design is the "AsanDesk Error" file: header with language and theme switches, the logo that
splits in two, error code, message, hint, two actions and a reference id. The pages are plain
HTML with inline CSS and a little JS (no framework), so they work even when the backend and the
frontend are down. Fonts are in nginx/errors/fonts.

    python3 scripts/gen-error-pages.py

nginx replaces the text __REF__ with a short form of $request_id (sub_filter), which is also in the
access log, so a user can send the owner the reference id and the owner finds the request.
Edit the texts below and run the script again; the generated files are committed.
"""
import json
import os
from html import escape

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'nginx', 'errors')

# Where "back to home" goes: the panel opens its own root, the public API host goes to the site
TARGETS = {
    'panel': {'home': '/', 'login': '/login'},
    'api': {'home': 'https://asandesk.ir', 'login': None},
}

UI = {
    'fa': {'brand': 'آسان دسک', 'langAria': 'زبان', 'themeAria': 'پوسته', 'light': 'پوستهٔ روشن',
           'dark': 'پوستهٔ تیره', 'errLabel': 'کد خطا', 'refLabel': 'شناسهٔ پیگیری', 'copy': 'کپی',
           'copied': 'کپی شد', 'replay': 'پخش دوبارهٔ انیمیشن'},
    'en': {'brand': 'AsanDesk', 'langAria': 'Language', 'themeAria': 'Theme', 'light': 'Light theme',
           'dark': 'Dark theme', 'errLabel': 'Error code', 'refLabel': 'Reference ID', 'copy': 'Copy',
           'copied': 'Copied', 'replay': 'Replay animation'},
}

# kind: home | login | back | retry
ERRORS = {
    '404': {
        'fa': {'title': 'صفحه پیدا نشد', 'msg': 'آدرسی که باز کردید وجود ندارد یا جابه‌جا شده است.',
               'hint': 'آدرس را بررسی کنید یا به صفحهٔ اصلی برگردید.',
               'p1': ['بازگشت به خانه', 'home'], 'p2': ['صفحهٔ قبل', 'back']},
        'en': {'title': 'Page not found', 'msg': 'The address you opened doesn’t exist or has been moved.',
               'hint': 'Check the address or go back to the home screen.',
               'p1': ['Back to home', 'home'], 'p2': ['Previous page', 'back']},
    },
    '403': {
        'fa': {'title': 'دسترسی ندارید', 'msg': 'اجازهٔ دیدن این صفحه یا اتصال به این دستگاه را ندارید.',
               'hint': 'از مالک دستگاه بخواهید دسترسی شما را فعال کند.',
               'p1': ['بازگشت به خانه', 'home'], 'p2': ['ورود با حساب دیگر', 'login']},
        'en': {'title': 'Access denied',
               'msg': 'You don’t have permission to view this page or connect to this device.',
               'hint': 'Ask the device owner to grant you access.',
               'p1': ['Back to home', 'home'], 'p2': ['Sign in with another account', 'login']},
    },
    '500': {
        'fa': {'title': 'مشکلی در سرور پیش آمد', 'msg': 'این خطا از سمت ماست، نه شما.',
               'hint': 'چند لحظه بعد دوباره امتحان کنید.',
               'p1': ['تلاش دوباره', 'retry'], 'p2': ['بازگشت به خانه', 'home']},
        'en': {'title': 'Something went wrong on our side', 'msg': 'This error is on our end, not yours.',
               'hint': 'Try again in a few moments.',
               'p1': ['Try again', 'retry'], 'p2': ['Back to home', 'home']},
    },
    # 502, 503 and 504 (a service behind nginx is down or restarting) use this page
    '503': {
        'fa': {'title': 'در حال به‌روزرسانی', 'msg': 'آسان دسک موقتاً در دسترس نیست.',
               'hint': 'معمولاً چند دقیقه طول می‌کشد؛ بعداً دوباره سر بزنید.',
               'p1': ['تلاش دوباره', 'retry'], 'p2': ['بازگشت به خانه', 'home']},
        'en': {'title': 'Down for maintenance', 'msg': 'AsanDesk is temporarily unavailable.',
               'hint': 'This usually takes a few minutes. Check back soon.',
               'p1': ['Try again', 'retry'], 'p2': ['Back to home', 'home']},
    },
}

CSS = """
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:400 700;font-display:swap;src:url(/__errors/fonts/vazirmatn-arabic.woff2) format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+0870-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:400 700;font-display:swap;src:url(/__errors/fonts/vazirmatn-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:400 700;font-display:swap;src:url(/__errors/fonts/vazirmatn-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
:root{--page:#F1F4F4;--card:#FFFFFF;--line:#E2E8E8;--ink:#0F1F1E;--muted:#5C6B6B;--accent:#1D7F5E;--accent-soft:#E7F4EE;--on-accent:#FFFFFF;--danger:#C62F3C;--danger-soft:#FBEBEC;--danger-line:#F1C4C8}
:root[data-theme=dark]{--page:#0A100F;--card:#151D1C;--line:#26312F;--ink:#E8F0EF;--muted:#9DB0AE;--accent:#26A379;--accent-soft:#10322A;--on-accent:#06201E;--danger:#F2727D;--danger-soft:#2E1619;--danger-line:#5A2A30}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:var(--page);color:var(--ink);font-family:Vazirmatn,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
button{font-family:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
header{height:52px;flex:none;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--card);border-bottom:1px solid var(--line)}
.mark{width:28px;height:28px;flex:none;display:block}
.brand{font:600 15px/1 Vazirmatn,sans-serif;white-space:nowrap}
.sp{flex:1}
.seg{display:flex;gap:2px;padding:2px;border:1px solid var(--line);border-radius:999px}
.seg button{min-width:36px;height:32px;border:0;cursor:pointer;border-radius:999px;background:transparent;color:var(--muted);font:600 12px/1 Vazirmatn,sans-serif;display:flex;align-items:center;justify-content:center}
.seg button[aria-pressed=true]{background:var(--accent);color:var(--on-accent)}
.seg.theme button{width:36px;min-width:0}
.seg.theme button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
.seg svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.wrap{width:100%;max-width:520px;display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center}
.logo{border:0;background:none;padding:0;cursor:pointer;display:block;border-radius:24px}
.info{display:flex;flex-direction:column;align-items:center;gap:16px;animation:adRise .6s ease-out 1.1s both}
.pill{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border-radius:999px;border:1px solid var(--danger-line);background:var(--danger-soft);color:var(--danger)}
.pill svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.pill span{font:600 13px/1.6 Vazirmatn,sans-serif}
.pill b{font:700 13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.5px}
h1{margin:0;font:700 30px/1.4 Vazirmatn,sans-serif;text-wrap:balance}
.msg{margin:0;font:400 15px/1.8 Vazirmatn,sans-serif;color:var(--muted);max-width:420px;text-wrap:pretty}
.hint{display:flex;align-items:flex-start;gap:8px;padding:12px 16px;border-radius:12px;background:var(--accent-soft);color:var(--ink);max-width:420px;text-align:start}
.hint svg{width:20px;height:20px;flex:none;display:block;color:var(--accent);margin-top:2px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.hint span{font:400 14px/1.7 Vazirmatn,sans-serif}
.acts{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;width:100%;animation:adRise .6s ease-out 1.25s both}
.btn{height:48px;min-width:176px;padding:0 24px;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--ink);font:600 15px/1 Vazirmatn,sans-serif;text-decoration:none;display:flex;align-items:center;justify-content:center}
.btn:hover{background:var(--accent-soft)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.primary:hover{opacity:.92;background:var(--accent)}
.ref{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;animation:adRise .6s ease-out 1.4s both}
.ref .l{font:400 13px/1.6 Vazirmatn,sans-serif;color:var(--muted)}
.ref .id{font:500 13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);text-transform:uppercase}
.ref button{height:32px;padding:0 8px;display:flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--muted);cursor:pointer;font:500 12px/1 Vazirmatn,sans-serif}
.ref button[data-done=true]{color:var(--accent)}
.ref button svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.lg-bg{fill:var(--accent)}.lg-st{fill:none;stroke:var(--on-accent);stroke-width:2.8}
.lg-sh{fill:var(--ink)}.lg-f1{fill:var(--accent)}.lg-f2{fill:var(--muted)}
@keyframes adShake{0%,100%{transform:translate(0,0)}12%{transform:translate(-.35px,.1px) rotate(-1deg)}28%{transform:translate(.35px,-.1px) rotate(1deg)}44%{transform:translate(-.5px,.15px) rotate(-1.5deg)}60%{transform:translate(.5px,-.15px) rotate(1.5deg)}80%{transform:translate(-.2px,0)}}
@keyframes adSplitL{0%{transform:translate(0,0) rotate(0)}55%{transform:translate(-2.3px,.3px) rotate(-6deg)}78%{transform:translate(-1.5px,.6px) rotate(-3.2deg)}100%{transform:translate(-1.8px,.5px) rotate(-4deg)}}
@keyframes adSplitR{0%{transform:translate(0,0) rotate(0)}55%{transform:translate(2.3px,1.6px) rotate(7deg)}78%{transform:translate(1.5px,1px) rotate(4.2deg)}100%{transform:translate(1.8px,1.2px) rotate(5deg)}}
@keyframes adFloatL{from{transform:translate(0,0) rotate(0)}to{transform:translate(-.3px,-.7px) rotate(-1.2deg)}}
@keyframes adFloatR{from{transform:translate(0,0) rotate(0)}to{transform:translate(.3px,-.4px) rotate(1.4deg)}}
@keyframes adFall{0%{transform:translate(0,0) rotate(0);opacity:0}8%{opacity:1}100%{transform:translate(var(--dx),13px) rotate(var(--rot));opacity:0}}
@keyframes adShadow{from{transform:scaleX(1);opacity:.14}to{transform:scaleX(.88);opacity:.09}}
@keyframes adRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
"""

BODY_SVG = ('<rect class="lg-bg" width="24" height="24" rx="6"/>'
            '<path class="lg-st" d="M4.6 12.2 11.4 5.6 16 10.2"/>'
            '<path class="lg-st" d="M8 13.8 12 17.8 19.6 10.2"/>')

LOGO = (
    '<svg viewBox="-6 -6 36 42" width="176" height="206" aria-hidden="true" style="display:block;overflow:visible">'
    '<ellipse class="lg-sh" cx="12" cy="29" rx="9" ry="1.1" style="transform-box:fill-box;transform-origin:center;'
    'animation:adShadow 3.6s ease-in-out 1.6s infinite alternate;opacity:.12"/>'
    '<g style="transform-origin:12px 12px;animation:adShake .55s ease-in-out">'
    # left half
    '<g style="transform-origin:0px 24px;animation:adFloatL 3.6s ease-in-out 1.6s infinite alternate">'
    '<g style="transform-origin:0px 24px;transform:translate(-1.8px,.5px) rotate(-4deg);'
    'animation:adSplitL 1.1s cubic-bezier(.2,.8,.3,1) .55s both">'
    '<clipPath id="adL"><polygon points="0,0 13,0 10.6,6 14,10 11,15 13.6,19 12,24 0,24"/></clipPath>'
    '<g clip-path="url(#adL)">' + BODY_SVG + '</g></g></g>'
    # right half
    '<g style="transform-origin:24px 24px;animation:adFloatR 3.6s ease-in-out 1.6s infinite alternate">'
    '<g style="transform-origin:24px 24px;transform:translate(1.8px,1.2px) rotate(5deg);'
    'animation:adSplitR 1.1s cubic-bezier(.2,.8,.3,1) .55s both">'
    '<clipPath id="adR"><polygon points="24,0 24,24 12,24 13.6,19 11,15 14,10 10.6,6 13,0"/></clipPath>'
    '<g clip-path="url(#adR)">' + BODY_SVG + '</g></g></g>'
    # falling fragments
    '<g>'
    '<path class="lg-f1" d="M11.6 7.6 13.2 9.4 11.2 10Z" style="--dx:-3px;--rot:-140deg;opacity:0;animation:adFall 2.6s ease-in 1.5s infinite"/>'
    '<path class="lg-f1" d="M12.4 13 13.9 14.4 12.3 15.4Z" style="--dx:3px;--rot:120deg;opacity:0;animation:adFall 2.6s ease-in 2.3s infinite"/>'
    '<path class="lg-f2" d="M11.9 17.2 13 18.6 11.6 19.2Z" style="--dx:-1.5px;--rot:200deg;opacity:0;animation:adFall 2.6s ease-in 3.1s infinite"/>'
    '<path class="lg-f2" d="M12.8 4.2 13.6 5.4 12.4 5.6Z" style="--dx:2px;--rot:-90deg;opacity:0;animation:adFall 2.6s ease-in 3.8s infinite"/>'
    '</g></g></svg>'
)

ICON_SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'
ICON_MOON = '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'
ICON_ALERT = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2h.01"/>'
ICON_INFO = '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8h.01"/>'
ICON_COPY = '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'
ICON_CHECK = '<path d="M5.5 12.5 10 17l8.5-9"/>'

# Theme and language are decided before the first paint, so there is no flash
HEAD_JS = ("(function(){try{var d=document.documentElement,t=localStorage.getItem('ad-theme'),l=localStorage.getItem('ad-lang');"
           "if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';"
           "d.setAttribute('data-theme',t);if(l==='en'){d.lang='en';d.dir='ltr'}}catch(e){}})()")

BODY_JS = """
(function () {
  var D = window.__AD, root = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function href(kind) {
    if (kind === 'home') return D.home;
    if (kind === 'login' && D.login) return D.login;
    return '#';
  }
  function act(el, p) {
    el.textContent = p[0];
    el.setAttribute('data-kind', p[1]);
    el.setAttribute('href', href(p[1]));
  }
  function lang(l) {
    var t = D.ui[l], e = D.err[l];
    root.lang = l; root.dir = l === 'fa' ? 'rtl' : 'ltr';
    $('brand').textContent = t.brand;
    $('errLabel').textContent = t.errLabel;
    $('refLabel').textContent = t.refLabel;
    $('title').textContent = e.title; $('msg').textContent = e.msg; $('hint').textContent = e.hint;
    act($('p1'), e.p1); act($('p2'), e.p2);
    $('copyText').textContent = t.copy;
    $('langG').setAttribute('aria-label', t.langAria); $('themeG').setAttribute('aria-label', t.themeAria);
    $('light').setAttribute('aria-label', t.light); $('dark').setAttribute('aria-label', t.dark);
    $('logo').setAttribute('aria-label', t.replay); $('logo').title = t.replay;
    $('fa').setAttribute('aria-pressed', l === 'fa'); $('en').setAttribute('aria-pressed', l === 'en');
    document.title = e.title + ' · ' + t.brand;
    D.cur = l;
  }
  function theme(t) {
    root.setAttribute('data-theme', t);
    $('light').setAttribute('aria-pressed', t === 'light'); $('dark').setAttribute('aria-pressed', t === 'dark');
  }
  $('fa').onclick = function () { store('ad-lang', 'fa'); lang('fa'); };
  $('en').onclick = function () { store('ad-lang', 'en'); lang('en'); };
  $('light').onclick = function () { store('ad-theme', 'light'); theme('light'); };
  $('dark').onclick = function () { store('ad-theme', 'dark'); theme('dark'); };
  $('logo').onclick = function () { var b = $('logo'), h = b.innerHTML; b.innerHTML = ''; void b.offsetWidth; b.innerHTML = h; };
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-kind]');
    if (!a) return;
    var k = a.getAttribute('data-kind');
    if (k === 'retry') { ev.preventDefault(); location.reload(); }
    else if (k === 'back') { ev.preventDefault(); history.back(); }
  });
  var cb = $('copy');
  if (cb) cb.onclick = function () {
    var id = $('refId').textContent, done = function () {
      cb.setAttribute('data-done', 'true'); $('copyText').textContent = D.ui[D.cur].copied;
      $('copyIcon').innerHTML = D.check;
      setTimeout(function () { cb.removeAttribute('data-done'); $('copyText').textContent = D.ui[D.cur].copy; $('copyIcon').innerHTML = D.copy; }, 1800);
    };
    try { navigator.clipboard.writeText(id).then(done, done); } catch (e) { done(); }
  };
  theme(root.getAttribute('data-theme') || 'light');
  lang(root.lang === 'en' ? 'en' : 'fa');
})();
"""


def svg_icon(inner):
    return f'<svg viewBox="0 0 24 24" aria-hidden="true">{inner}</svg>'


def page(code: str, target: str) -> str:
    err = ERRORS[code]
    t = TARGETS[target]
    ui = UI['fa']
    # on the API host there is no login page: that action becomes "previous page"
    err_for = json.loads(json.dumps(err))
    if t['login'] is None:
        for lang_ in ('fa', 'en'):
            for k in ('p1', 'p2'):
                if err_for[lang_][k][1] == 'login':
                    err_for[lang_][k] = UI_BACK[lang_]
    fa = err_for['fa']
    data = {
        'ui': UI, 'err': {'fa': err_for['fa'], 'en': err_for['en']},
        'home': t['home'], 'login': t['login'],
        'copy': ICON_COPY, 'check': ICON_CHECK, 'cur': 'fa',
    }
    action = lambda i, p: f'<a id="p{i}" class="btn{" primary" if i == 1 else ""}" data-kind="{p[1]}" href="{escape(href_for(p[1], t))}">{escape(p[0])}</a>'
    return f"""<!doctype html>
<html lang="fa" dir="rtl" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>{escape(fa['title'])} · {escape(ui['brand'])}</title>
<style>{CSS}</style>
<script>{HEAD_JS}</script>
</head>
<body>
<header>
<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect class="lg-bg" width="24" height="24" rx="6"/><path class="lg-st" d="M4.6 12.2 11.4 5.6 16 10.2" style="stroke-linejoin:miter"/><path class="lg-st" d="M8 13.8 12 17.8 19.6 10.2" style="stroke-linejoin:miter"/></svg>
<span class="brand" id="brand">{escape(ui['brand'])}</span>
<div class="sp"></div>
<div class="seg" id="langG" role="group" aria-label="{escape(ui['langAria'])}"><button type="button" id="fa" aria-pressed="true">FA</button><button type="button" id="en" aria-pressed="false">EN</button></div>
<div class="seg theme" id="themeG" role="group" aria-label="{escape(ui['themeAria'])}"><button type="button" id="light" aria-label="{escape(ui['light'])}" aria-pressed="true">{svg_icon(ICON_SUN)}</button><button type="button" id="dark" aria-label="{escape(ui['dark'])}" aria-pressed="false">{svg_icon(ICON_MOON)}</button></div>
</header>
<main>
<div class="wrap">
<button type="button" class="logo" id="logo" aria-label="{escape(ui['replay'])}" title="{escape(ui['replay'])}">{LOGO}</button>
<div class="info">
<div class="pill">{svg_icon(ICON_ALERT)}<span id="errLabel">{escape(ui['errLabel'])}</span><b dir="ltr">{code}</b></div>
<h1 id="title">{escape(fa['title'])}</h1>
<p class="msg" id="msg">{escape(fa['msg'])}</p>
<div class="hint">{svg_icon(ICON_INFO)}<span id="hint">{escape(fa['hint'])}</span></div>
</div>
<div class="acts">{action(1, fa['p1'])}{action(2, fa['p2'])}</div>
<div class="ref"><span class="l" id="refLabel">{escape(ui['refLabel'])}</span><span class="id" id="refId" dir="ltr">__REF__</span>
<button type="button" id="copy"><svg viewBox="0 0 24 24" aria-hidden="true" id="copyIcon">{ICON_COPY}</svg><span id="copyText">{escape(ui['copy'])}</span></button></div>
</div>
</main>
<script>window.__AD={json.dumps(data, ensure_ascii=False)};</script>
<script>{BODY_JS}</script>
</body>
</html>
"""


UI_BACK = {'fa': ['صفحهٔ قبل', 'back'], 'en': ['Previous page', 'back']}


def href_for(kind, t):
    if kind == 'home':
        return t['home']
    if kind == 'login' and t['login']:
        return t['login']
    return '#'


def main():
    n = 0
    for target in TARGETS:
        d = os.path.join(OUT, target)
        os.makedirs(d, exist_ok=True)
        for code in ERRORS:
            with open(os.path.join(d, f'{code}.html'), 'w', encoding='utf-8', newline='\n') as f:
                f.write(page(code, target))
            n += 1
    print(f'{n} pages written to {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
