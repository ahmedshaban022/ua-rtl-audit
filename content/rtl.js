// Content side of UA RTL Audit: flips the page direction (idempotent,
// exactly restorable), collects per-element facts, runs the pure
// predicates from UARtlCore, and renders a shadow-DOM panel with the
// findings. Nothing here mutates page content beyond dir/lang attributes
// and the panel host.
'use strict';
(function () {
  const URA = (window.UARtlAudit = window.UARtlAudit || {});
  const C = window.UARtlCore;

  const MAX_ELEMENTS = 2000; // audit budget: enough for real pages, bounded always
  const MAX_PER_INFO_CODE = 25; // info-level checks can flood; cap + note the rest
  const FLASH_MS = 1200;
  const HOST_ID = 'ua-rtl-audit-host';

  // ---------- toggle ----------

  URA._state = URA._state || { flipped: false, originalDir: null, originalLang: null };

  URA.state = function () {
    return { flipped: URA._state.flipped };
  };

  URA.toggle = function (langAr) {
    const doc = document.documentElement;
    if (URA._state.flipped) return URA.restore();
    URA._state.originalDir = doc.getAttribute('dir'); // null = absent, restore exactly
    URA._state.originalLang = doc.getAttribute('lang');
    doc.setAttribute('dir', 'rtl');
    if (langAr) doc.setAttribute('lang', 'ar');
    URA._state.flipped = true;
    return { flipped: true, dir: 'rtl', lang: doc.getAttribute('lang') };
  };

  URA.restore = function () {
    const doc = document.documentElement;
    const s = URA._state;
    if (!s.flipped) return { flipped: false };
    if (s.originalDir == null) doc.removeAttribute('dir');
    else doc.setAttribute('dir', s.originalDir);
    if (s.originalLang == null) doc.removeAttribute('lang');
    else doc.setAttribute('lang', s.originalLang);
    s.flipped = false;
    removePanel();
    return { flipped: false, dir: C ? C.normalizeDir(s.originalDir) : 'ltr' };
  };

  // ---------- audit ----------

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls =
      (typeof el.className === 'string' ? el.className : '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => '.' + c)
        .join('');
    const s = tag + id + cls;
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }

  function hasDirectText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
    }
    return false;
  }

  function collect() {
    const issues = [];
    const capped = {}; // code -> already emitted (info caps)
    const viewW = document.documentElement.clientWidth;
    const viewH = document.documentElement.clientHeight;

    const scroller = document.scrollingElement || document.documentElement;
    const docIssue = C.checkDocOverflow({ scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth });
    if (docIssue) issues.push(Object.assign({ selector: 'html' }, docIssue));

    const all = document.querySelectorAll('body *');
    let audited = 0;
    for (const el of all) {
      if (audited >= MAX_ELEMENTS) break;
      if (el.id === HOST_ID || (el.closest && el.closest('#' + HOST_ID))) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      audited++;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;

      // Clipping is only meaningful when the document itself doesn't
      // overflow (otherwise everything "crosses" the edge).
      if (!docIssue) {
        const clip = C.checkClipping({ visible: true, rect: r, viewportWidth: viewW });
        if (clip) issues.push(Object.assign({ selector: describe(el), el }, clip));
      }

      const trunc = C.checkTruncation({
        hasText: hasDirectText(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: cs.overflowX,
        textOverflow: cs.textOverflow
      });
      if (trunc) issues.push(Object.assign({ selector: describe(el), el }, trunc));

      const align = C.checkPhysicalAlign(cs.textAlign);
      if (align) maybeCap(issues, capped, 'physical-align', Object.assign({ selector: describe(el), el }, align));

      if (el.tagName === 'INPUT' && !el.disabled && el.type !== 'hidden') {
        const dirInput = C.checkDirInput({ type: el.type, hasDir: el.hasAttribute('dir') });
        if (dirInput) issues.push(Object.assign({ selector: describe(el), el }, dirInput));
      }

      const icon = C.checkIconNaming([el.id, typeof el.className === 'string' ? el.className : '', el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt') || '']);
      if (icon) maybeCap(issues, capped, 'icon-naming', Object.assign({ selector: describe(el), el }, icon));
    }

    for (const [code, n] of Object.entries(capped)) {
      if (n > MAX_PER_INFO_CODE) {
        issues.push({
          code,
          severity: 'info',
          selector: '…',
          detail: `${n - MAX_PER_INFO_CODE} more ${code} findings hidden (cap ${MAX_PER_INFO_CODE})`
        });
      }
    }

    return {
      issues, // still carries live `el` refs for the panel; stripped on the wire
      meta: {
        title: document.title,
        url: location.href,
        dir: document.dir || C.normalizeDir(document.documentElement.getAttribute('dir')),
        flippedFrom: URA._state.flipped ? C.normalizeDir(URA._state.originalDir) : null,
        lang: document.documentElement.getAttribute('lang'),
        langTemporary: URA._state.flipped,
        viewportWidth: viewW,
        viewportHeight: viewH,
        audited
      }
    };
  }

  function maybeCap(issues, capped, code, issue) {
    capped[code] = (capped[code] || 0) + 1;
    if (capped[code] <= MAX_PER_INFO_CODE) issues.push(issue);
  }

  URA.audit = function () {
    const { issues, meta } = collect();
    const summary = C.summarize(issues);
    const report = C.buildReport(
      issues.map(({ el, ...rest }) => rest), // no element refs in the report
      meta
    );
    URA._lastReport = report;
    renderPanel(issues, summary);
    return { summary, report };
  };

  URA.report = function () {
    return { report: URA._lastReport || null };
  };

  // ---------- panel (shadow DOM: zero CSS collision with the page) ----------

  function removePanel() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }

  function flash(el) {
    if (!el || !el.isConnected) return;
    el.classList.add('ua-rtl-flash');
    setTimeout(() => el.classList.remove('ua-rtl-flash'), FLASH_MS);
  }

  const SEV_COLOR = { error: '#f87171', warn: '#fbbf24', info: '#9ca3af' };

  function renderPanel(issues, summary) {
    removePanel();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;all:initial';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        width: 380px; max-height: 420px; display:flex; flex-direction:column;
        background: #111827; color: #e5e7eb; border: 1px solid #374151;
        border-radius: 12px; font: 13px/1.4 system-ui, sans-serif;
        box-shadow: 0 24px 60px rgba(0,0,0,.65);
      }
      .head { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid #374151; }
      .head b { color:#a78bfa; letter-spacing:.4px; font-size:12px; }
      .chip { font-size:11px; font-weight:600; padding:1px 8px; border-radius:999px; background:#1f2937; }
      .chip.error { color:${SEV_COLOR.error}; } .chip.warn { color:${SEV_COLOR.warn}; } .chip.info { color:${SEV_COLOR.info}; }
      .close { margin-left:auto; background:none; border:0; color:#9ca3af; font-size:16px; cursor:pointer; padding:0 4px; }
      .close:hover { color:#e5e7eb; }
      .list { overflow:auto; padding:6px 0; flex:1; }
      .issue { padding:7px 12px; cursor:pointer; }
      .issue:hover { background:#1f2937; }
      .issue .d { display:flex; gap:7px; align-items:baseline; }
      .issue .dot { width:8px; height:8px; border-radius:50%; flex:none; align-self:center; }
      .issue .code { color:#d1d5db; font-weight:600; font-size:12px; }
      .issue .detail { color:#9ca3af; font-size:12px; }
      .issue .sel { color:#6b7280; font-size:11px; margin-left:15px; }
      .empty { padding:22px 12px; text-align:center; color:#9ca3af; }
      .foot { display:flex; gap:8px; padding:10px 12px; border-top:1px solid #374151; }
      .foot button {
        flex:1; padding:7px 8px; border:0; border-radius:8px; cursor:pointer;
        font:600 12px system-ui, sans-serif; background:#374151; color:#e5e7eb;
      }
      .foot button:hover { background:#4b5563; }
      .foot button.primary { background:#7c3aed; color:#fff; }
      .foot button.primary:hover { background:#6d28d9; }
    `;
    root.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'panel';
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML =
      '<b>RTL AUDIT</b>' +
      (summary.error ? `<span class="chip error">${summary.error} error</span>` : '') +
      (summary.warn ? `<span class="chip warn">${summary.warn} warn</span>` : '') +
      (summary.info ? `<span class="chip info">${summary.info} info</span>` : '') +
      '<button class="close" title="Close">×</button>';
    panel.appendChild(head);
    head.querySelector('.close').addEventListener('click', removePanel);

    const list = document.createElement('div');
    list.className = 'list';
    if (!issues.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No RTL issues found. 🎉';
      list.appendChild(empty);
    }
    const index = []; // parallel element refs so clicks map back to the page
    for (const issue of issues) {
      const row = document.createElement('div');
      row.className = 'issue';
      const d = document.createElement('div');
      d.className = 'd';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = SEV_COLOR[issue.severity] || SEV_COLOR.info;
      d.appendChild(dot);
      const code = document.createElement('span');
      code.className = 'code';
      code.textContent = issue.code;
      d.appendChild(code);
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = issue.detail;
      d.appendChild(detail);
      row.appendChild(d);
      const sel = document.createElement('div');
      sel.className = 'sel';
      sel.textContent = issue.selector || '';
      row.appendChild(sel);
      const el = issue.el || null;
      index.push(el);
      row.addEventListener('click', () => {
        if (el && el.isConnected) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          flash(el);
        }
      });
      list.appendChild(row);
    }
    panel.appendChild(list);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const copy = document.createElement('button');
    copy.className = 'primary';
    copy.textContent = 'Copy report';
    copy.addEventListener('click', () => copyText(URA._lastReport || '').then(() => (copy.textContent = 'Copied ✓')).catch(() => (copy.textContent = 'Copy failed')));
    foot.appendChild(copy);
    const rerun = document.createElement('button');
    rerun.textContent = 'Re-run';
    rerun.addEventListener('click', () => URA.audit());
    foot.appendChild(rerun);
    if (URA._state.flipped) {
      const restore = document.createElement('button');
      restore.textContent = 'Restore LTR';
      restore.addEventListener('click', () => URA.restore());
      foot.appendChild(restore);
    }
    panel.appendChild(foot);

    root.appendChild(panel);
    document.body.appendChild(host);

    // flash outline lives in the light DOM (it targets page elements)
    if (!document.getElementById('ua-rtl-style')) {
      const s = document.createElement('style');
      s.id = 'ua-rtl-style';
      s.textContent = `.ua-rtl-flash{outline:3px solid #fbbf24!important;outline-offset:1px!important;transition:outline .15s;}`;
      document.head ? document.head.appendChild(s) : document.documentElement.appendChild(s);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy refused'));
      } catch (e) {
        reject(e);
      } finally {
        ta.remove();
      }
    });
  }
})();
