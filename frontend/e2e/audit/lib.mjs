// Shared instrumentation for the UI/UX audit harness.
//
// Everything here is injected into the page: the metrics collector runs inside
// the browser and returns plain JSON so the report can cite hard numbers
// instead of impressions.

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);

export function resolveAxePath() {
  const candidates = [];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch (_) { /* fall through */ }
  candidates.push(path.resolve('node_modules', 'axe-core', 'axe.min.js'));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('axe-core not found; checked: ' + candidates.join(', '));
}

/** Collected before any app script runs, so early layout shifts are seen. */
export const INIT_SCRIPT = () => {
  window.__audit = { cls: 0, shifts: [], longTasks: 0, longTaskMs: 0, rejections: [], errors: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__audit.cls += e.value;
          window.__audit.shifts.push({ value: Number(e.value.toFixed(4)), t: Math.round(e.startTime) });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) { /* unsupported */ }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__audit.longTasks += 1;
        window.__audit.longTaskMs += e.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) { /* unsupported */ }
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    window.__audit.rejections.push(String((r && r.message) || r).slice(0, 300));
  });
};

/** Runs in the page. Keep it self-contained: no closure over module scope. */
export const COLLECT = () => {
  // En móvil, si el layout desborda, el navegador ENSANCHA el viewport de
  // layout (window.innerWidth crece y la página se ve alejada). Medir el
  // desborde contra ese valor lo escondía: se mide contra el viewport visual.
  const vw = Math.round((window.visualViewport && window.visualViewport.width) || window.innerWidth);
  const vh = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight);

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };

  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(p + '#' + cur.id); break; }
      const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) p += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(p);
      cur = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };

  const label = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 70);

  const inScroller = (el) => {
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const s = getComputedStyle(cur);
      if (/(auto|scroll)/.test(s.overflowX) && cur.scrollWidth > cur.clientWidth + 1) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  const all = Array.from(document.querySelectorAll('body *')).filter(isVisible);

  // --- horizontal overflow -------------------------------------------------
  const offenders = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      if (inScroller(el)) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' && r.right <= vw + 1) continue;
      offenders.push({
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        text: label(el).slice(0, 50),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        overhang: Math.round(r.right - vw),
      });
    }
  }
  offenders.sort((a, b) => b.overhang - a.overhang);

  // --- touch targets -------------------------------------------------------
  const targetSel = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], input:not([type="hidden"]), select, textarea, summary';
  const smallTargets = [];
  for (const el of Array.from(document.querySelectorAll(targetSel))) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      smallTargets.push({
        selector: cssPath(el),
        tag: el.tagName.toLowerCase(),
        name: label(el).slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        under24: r.width < 24 || r.height < 24,
      });
    }
  }
  smallTargets.sort((a, b) => (a.w * a.h) - (b.w * b.h));

  // --- legibility ----------------------------------------------------------
  const tinyText = [];
  for (const el of all) {
    if (!el.childNodes.length) continue;
    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasOwnText) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) tinyText.push({ selector: cssPath(el), text: label(el).slice(0, 40), px: size });
  }

  // --- clipped / truncated text -------------------------------------------
  const clipped = [];
  for (const el of all) {
    if (!el.childNodes.length) continue;
    const s = getComputedStyle(el);
    const clips = s.overflowX === 'hidden' || s.textOverflow === 'ellipsis' || s.whiteSpace === 'nowrap';
    if (clips && el.scrollWidth > el.clientWidth + 2 && label(el)) {
      clipped.push({ selector: cssPath(el), text: label(el).slice(0, 40), clientW: el.clientWidth, scrollW: el.scrollWidth });
    }
  }

  // --- accessible names ----------------------------------------------------
  const nameless = [];
  for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea'))) {
    if (!isVisible(el)) continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || '').trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    const imgAlt = el.querySelector && el.querySelector('img[alt]:not([alt=""])');
    if (!name && !labelledBy && !imgAlt) {
      nameless.push({ selector: cssPath(el), tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '' });
    }
  }

  const imagesNoAlt = Array.from(document.querySelectorAll('img')).filter((i) => !i.hasAttribute('alt') && isVisible(i)).map((i) => ({ src: (i.currentSrc || i.src || '').slice(-60), selector: cssPath(i) }));

  const inputsNoLabel = [];
  for (const el of Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'))) {
    if (!isVisible(el)) continue;
    const id = el.id;
    const hasFor = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
    const wrapped = el.closest('label');
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('placeholder');
    if (!hasFor && !wrapped && !aria) inputsNoLabel.push({ selector: cssPath(el), type: el.getAttribute('type') || el.tagName.toLowerCase() });
  }

  // --- structure -----------------------------------------------------------
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(isVisible).map((h) => ({ level: Number(h.tagName[1]), text: label(h).slice(0, 60) }));
  const headingJumps = [];
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i].level - headings[i - 1].level > 1) headingJumps.push({ from: headings[i - 1], to: headings[i] });
  }

  const ids = {};
  const duplicateIds = [];
  for (const el of Array.from(document.querySelectorAll('[id]'))) {
    if (ids[el.id]) { if (!duplicateIds.includes(el.id)) duplicateIds.push(el.id); } else ids[el.id] = 1;
  }

  const focusables = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(isVisible)
    .filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
  const ariaHiddenFocusable = Array.from(document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] input')).filter(isVisible).length;

  const overlays = [];
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.position === 'sticky') {
      const r = el.getBoundingClientRect();
      overlays.push({ selector: cssPath(el), position: s.position, z: s.zIndex, top: Math.round(r.top), height: Math.round(r.height), text: label(el).slice(0, 30) });
    }
  }

  const skeletons = document.querySelectorAll('[class*="animate-pulse"], [class*="skeleton"], [role="progressbar"], .loading').length;
  const scrollables = Array.from(document.querySelectorAll('body *')).filter((el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4;
  }).length;

  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = performance.getEntriesByType('paint') || [];
  const fcp = (paints.find((p) => p.name === 'first-contentful-paint') || {}).startTime || null;

  const styles = {};
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      fontSize: s.fontSize,
      fontFamily: s.fontFamily.split(',')[0].replace(/["']/g, ''),
      fontWeight: s.fontWeight,
      color: s.color,
      background: s.backgroundColor,
      radius: s.borderRadius,
      padding: s.padding,
      height: Math.round(r.height),
    };
  };
  styles.h1 = probe('h1');
  styles.primaryButton = probe('button[class*="bg-primary"], .btn-primary, button');
  styles.body = probe('body');

  const audit = window.__audit || { cls: 0, longTasks: 0, longTaskMs: 0, rejections: [], shifts: [] };

  return {
    url: location.href,
    path: location.pathname,
    title: document.title,
    lang: document.documentElement.lang || null,
    dark: document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'),
    viewport: { w: vw, h: vh },
    docHeight: document.documentElement.scrollHeight,
    overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw,
    offenders: offenders.slice(0, 12),
    smallTargets: smallTargets.slice(0, 15),
    smallTargetCount: smallTargets.length,
    smallTargetCountUnder24: smallTargets.filter((t) => t.under24).length,
    tinyText: tinyText.slice(0, 10),
    tinyTextCount: tinyText.length,
    clipped: clipped.slice(0, 10),
    clippedCount: clipped.length,
    nameless: nameless.slice(0, 10),
    namelessCount: nameless.length,
    imagesNoAlt,
    inputsNoLabel,
    headings,
    h1Count: headings.filter((h) => h.level === 1).length,
    headingJumps,
    duplicateIds,
    focusableCount: focusables.length,
    ariaHiddenFocusable,
    landmarks: {
      header: document.querySelectorAll('header').length,
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      aside: document.querySelectorAll('aside').length,
      footer: document.querySelectorAll('footer').length,
    },
    overlays: overlays.slice(0, 10),
    domNodes: document.querySelectorAll('*').length,
    skeletons,
    scrollables,
    perf: {
      ttfb: nav.responseStart ? Math.round(nav.responseStart) : null,
      domContentLoaded: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
      fcp: fcp ? Math.round(fcp) : null,
      resources: performance.getEntriesByType('resource').length,
      transferKB: Math.round(performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
    },
    cls: Number(audit.cls.toFixed(4)),
    shifts: (audit.shifts || []).slice(0, 8),
    longTasks: audit.longTasks,
    longTaskMs: Math.round(audit.longTaskMs),
    rejections: (audit.rejections || []).slice(0, 5),
    styles,
  };
};

export async function runAxe(page, axePath) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const res = await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    });
    return res.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      count: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n) => ({
        target: (n.target || []).join(' ').slice(0, 120),
        summary: String(n.failureSummary || '').split('\n').slice(0, 3).join(' | ').slice(0, 260),
      })),
    }));
  });
}

export function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
