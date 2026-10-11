// Pure RTL-audit logic shared by the content script (as the global
// UARtlCore — classic scripts can't import ES modules) and the Node unit
// tests (as CommonJS). Every predicate takes plain data, never DOM nodes,
// so each rule is verifiable without a browser.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UARtlCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // Tolerances keep sub-pixel rounding and 1px borders out of the report.
  const OVERFLOW_TOLERANCE = 2; // px of document overflow before it counts
  const CLIP_TOLERANCE = 2; // px past the viewport edge before it counts
  const TRUNCATE_TOLERANCE = 2; // px of clipped text before it counts
  const MIN_ELEMENT_WIDTH = 8; // ignore slivers and zero-size boxes

  // input types whose content is direction-sensitive: digits and latin
  // fragments render mirrored under RTL unless the field pins a dir
  const DIR_SENSITIVE_INPUTS = ['number', 'tel', 'email', 'url'];

  // naming tokens that suggest an icon which may need mirroring
  const ICON_TOKEN_RE = /(left|right|arrow|chevron|next|prev|back|forward|caret)/i;

  // ---------- predicates (each: plain data in, issue-or-null out) ----------

  function checkDocOverflow(doc) {
    const scroll = (doc && doc.scrollWidth) || 0;
    const client = (doc && doc.clientWidth) || 0;
    const over = scroll - client;
    if (over > OVERFLOW_TOLERANCE) {
      return {
        code: 'viewport-overflow',
        severity: 'error',
        detail: `document is ${scroll}px wide in a ${client}px viewport (+${Math.round(over)}px)`
      };
    }
    return null;
  }

  function checkClipping(el) {
    if (!el || !el.visible || !el.rect) return null;
    const r = el.rect;
    if (r.width < MIN_ELEMENT_WIDTH) return null;
    const overLeft = -r.left; // RTL overflow typically escapes to the left
    const overRight = r.right - el.viewportWidth;
    if (overLeft > CLIP_TOLERANCE || overRight > CLIP_TOLERANCE) {
      const side = overLeft > overRight ? 'left' : 'right';
      const by = Math.round(Math.max(overLeft, overRight));
      return {
        code: 'clipped',
        severity: 'error',
        detail: `crosses the ${side} viewport edge by ${by}px`
      };
    }
    return null;
  }

  function checkTruncation(el) {
    if (!el || !el.hasText) return null;
    const clipped = (el.scrollWidth || 0) - (el.clientWidth || 0);
    if (clipped <= TRUNCATE_TOLERANCE) return null;
    const hidden = el.overflowX === 'hidden' || el.overflowX === 'clip' || el.textOverflow === 'ellipsis';
    if (!hidden) return null; // scrollable containers are not data loss
    return {
      code: 'truncated',
      severity: 'warn',
      detail: `text clipped by ${Math.round(clipped)}px (${el.textOverflow === 'ellipsis' ? 'ellipsis' : 'overflow hidden'})`
    };
  }

  function checkPhysicalAlign(textAlign) {
    if (textAlign !== 'left' && textAlign !== 'right') return null;
    return {
      code: 'physical-align',
      severity: 'info',
      detail: `uses physical text-align: ${textAlign} (prefer start/end)`
    };
  }

  function checkDirInput(input) {
    if (!input || input.hasDir) return null;
    if (!DIR_SENSITIVE_INPUTS.includes(input.type)) return null;
    return {
      code: 'dir-input',
      severity: 'warn',
      detail: `<input type=${input.type}> has no explicit dir — digits/email render mirrored under RTL`
    };
  }

  function checkIconNaming(tokens) {
    if (!tokens) return null;
    const list = Array.isArray(tokens) ? tokens : [tokens];
    for (const t of list) {
      if (typeof t === 'string' && ICON_TOKEN_RE.test(t)) {
        return {
          code: 'icon-naming',
          severity: 'info',
          detail: `name contains "${ICON_TOKEN_RE.exec(t)[0]}" — may need mirroring`
        };
      }
    }
    return null;
  }

  // ---------- aggregation / reporting ----------

  function summarize(issues) {
    const out = { error: 0, warn: 0, info: 0, total: 0 };
    for (const i of issues || []) {
      if (!i || !i.severity) continue;
      out.total++;
      if (i.severity === 'error') out.error++;
      else if (i.severity === 'warn') out.warn++;
      else out.info++;
    }
    return out;
  }

  function esc(s) {
    // backslash-escape backticks so titles/selectors can't break the
    // markdown code spans in the report
    return String(s == null ? '' : s).replace(/`/g, '\\`');
  }

  function buildReport(issues, meta) {
    const m = meta || {};
    const s = summarize(issues);
    const lines = [];
    lines.push(`# RTL audit — ${esc(m.title || 'page')}`);
    lines.push('');
    lines.push(`URL: ${esc(m.url || '')}`);
    lines.push(
      `Direction: ${m.dir || '?'}${m.flippedFrom ? ` (flipped from ${m.flippedFrom})` : ''}` +
        (m.lang ? ` · lang: ${m.lang}${m.langTemporary ? ' (temporary)' : ''}` : '')
    );
    lines.push(`Viewport: ${m.viewportWidth || '?'}×${m.viewportHeight || '?'} · audited elements: ${m.audited ?? '?'}`);
    lines.push('');
    if (!s.total) {
      lines.push('No RTL issues found. 🎉');
      return lines.join('\n');
    }
    const sections = [
      ['error', 'Errors'],
      ['warn', 'Warnings'],
      ['info', 'Info']
    ];
    for (const [sev, label] of sections) {
      const rows = (issues || []).filter((i) => i && i.severity === sev);
      if (!rows.length) continue;
      lines.push(`## ${label} (${rows.length})`);
      lines.push('');
      for (const i of rows) {
        lines.push(`- [${i.code}] ${i.selector ? esc(i.selector) + ' — ' : ''}${i.detail}`);
      }
      lines.push('');
    }
    lines.push('_Generated by UA RTL Audit._');
    return lines.join('\n');
  }

  // ---------- direction helpers ----------

  function normalizeDir(value) {
    const v = String(value || '').trim().toLowerCase();
    return v === 'rtl' ? 'rtl' : 'ltr'; // 'auto' and '' behave as ltr for flipping
  }

  return {
    OVERFLOW_TOLERANCE,
    CLIP_TOLERANCE,
    TRUNCATE_TOLERANCE,
    DIR_SENSITIVE_INPUTS,
    checkDocOverflow,
    checkClipping,
    checkTruncation,
    checkPhysicalAlign,
    checkDirInput,
    checkIconNaming,
    summarize,
    buildReport,
    normalizeDir
  };
});
