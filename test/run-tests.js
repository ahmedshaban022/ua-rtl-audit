// Unit tests: every pure predicate from shared/rtlcore.js against synthetic
// fixtures (clean + broken cases), plus summarize/buildReport/normalizeDir.
// Run: node test/run-tests.js
'use strict';

const path = require('node:path');

const C = require(path.join(__dirname, '..', 'shared', 'rtlcore.js'));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (detail ? ` :: ${detail}` : ''));
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---------- checkDocOverflow ----------
let i = C.checkDocOverflow({ scrollWidth: 1480, clientWidth: 1440 });
check('doc-overflow: fires', !!i && i.severity === 'error' && i.code === 'viewport-overflow');
check('doc-overflow: detail has delta', i && /\+40px/.test(i.detail), i && i.detail);
eq('doc-overflow: equal widths', C.checkDocOverflow({ scrollWidth: 1440, clientWidth: 1440 }), null);
eq('doc-overflow: within tolerance', C.checkDocOverflow({ scrollWidth: 1442, clientWidth: 1440 }), null);
eq('doc-overflow: zeroed input', C.checkDocOverflow({}), null);

// ---------- checkClipping ----------
i = C.checkClipping({ visible: true, rect: { left: -40, right: 60, width: 100 }, viewportWidth: 1440 });
check('clipping: left escape', !!i && i.severity === 'error' && /left/.test(i.detail));
i = C.checkClipping({ visible: true, rect: { left: 1460, right: 1500, width: 40 }, viewportWidth: 1440 });
check('clipping: right escape', !!i && /right/.test(i.detail));
eq('clipping: inside viewport', C.checkClipping({ visible: true, rect: { left: 0, right: 800, width: 800 }, viewportWidth: 1440 }), null);
eq('clipping: within tolerance', C.checkClipping({ visible: true, rect: { left: -1, right: 1439, width: 1440 }, viewportWidth: 1440 }), null);
eq('clipping: invisible', C.checkClipping({ visible: false, rect: { left: -50, right: 50, width: 100 }, viewportWidth: 1440 }), null);
eq('clipping: sliver ignored', C.checkClipping({ visible: true, rect: { left: -1, right: 7, width: 8 }, viewportWidth: 1440 }), null);
check(
  'clipping: tiny but far out still flags',
  !!C.checkClipping({ visible: true, rect: { left: -50, right: -42, width: 8 }, viewportWidth: 1440 })
);

// ---------- checkTruncation ----------
i = C.checkTruncation({ hasText: true, scrollWidth: 200, clientWidth: 120, overflowX: 'hidden', textOverflow: 'clip' });
check('truncation: hidden overflow', !!i && i.severity === 'warn' && /80px/.test(i.detail));
i = C.checkTruncation({ hasText: true, scrollWidth: 200, clientWidth: 120, overflowX: 'visible', textOverflow: 'ellipsis' });
check('truncation: ellipsis flagged', !!i && /ellipsis/.test(i.detail));
eq('truncation: scrollable is fine', C.checkTruncation({ hasText: true, scrollWidth: 200, clientWidth: 120, overflowX: 'auto', textOverflow: 'clip' }), null);
eq('truncation: no text', C.checkTruncation({ hasText: false, scrollWidth: 200, clientWidth: 120, overflowX: 'hidden', textOverflow: 'clip' }), null);
eq('truncation: within tolerance', C.checkTruncation({ hasText: true, scrollWidth: 121, clientWidth: 120, overflowX: 'hidden', textOverflow: 'clip' }), null);

// ---------- checkPhysicalAlign ----------
for (const ta of ['left', 'right']) {
  i = C.checkPhysicalAlign(ta);
  check(`align: ${ta} flagged as info`, !!i && i.severity === 'info' && i.code === 'physical-align');
}
for (const ta of ['start', 'end', 'center', 'justify', '']) {
  eq(`align: ${JSON.stringify(ta)} clean`, C.checkPhysicalAlign(ta), null);
}

// ---------- checkDirInput ----------
i = C.checkDirInput({ type: 'tel', hasDir: false });
check('dir-input: tel flagged', !!i && i.severity === 'warn' && i.code === 'dir-input');
eq('dir-input: has dir', C.checkDirInput({ type: 'tel', hasDir: true }), null);
eq('dir-input: text type', C.checkDirInput({ type: 'text', hasDir: false }), null);
eq('dir-input: number covered', C.checkDirInput({ type: 'number', hasDir: false }) === null, false);
eq('dir-input: checkbox ignored', C.checkDirInput({ type: 'checkbox', hasDir: false }), null);

// ---------- checkIconNaming ----------
i = C.checkIconNaming(['icon', 'icon-arrow-right']);
check('icon: arrow-right flagged', !!i && i.severity === 'info' && /arrow/.test(i.detail));
check('icon: chevron-left flagged', !!C.checkIconNaming(['chevron-left']));
check('icon: title matched', !!C.checkIconNaming([null, 'Next page']));
eq('icon: plain names clean', C.checkIconNaming(['btn', 'card']), null);
eq('icon: null clean', C.checkIconNaming(null), null);
eq('icon: empty clean', C.checkIconNaming(['', '   ']), null);

// ---------- summarize ----------
const mixed = [
  { severity: 'error', code: 'a' },
  { severity: 'error', code: 'b' },
  { severity: 'warn', code: 'c' },
  { severity: 'info', code: 'd' },
  null,
  { code: 'no-severity' }
];
const s = C.summarize(mixed);
eq('summarize: errors', s.error, 2);
eq('summarize: warns', s.warn, 1);
eq('summarize: infos', s.info, 1);
eq('summarize: total skips broken', s.total, 4);
eq('summarize: empty', C.summarize([]).total, 0);
eq('summarize: null list', C.summarize(null).total, 0);

// ---------- buildReport ----------
const report = C.buildReport(
  [
    { severity: 'error', code: 'viewport-overflow', selector: 'html', detail: 'document is 1480px wide in a 1440px viewport (+40px)' },
    { severity: 'warn', code: 'truncated', selector: '.title', detail: 'text clipped by 26px (ellipsis)' },
    { severity: 'info', code: 'physical-align', selector: '.price', detail: 'uses physical text-align: right (prefer start/end)' }
  ],
  { title: 'UA Projects', url: 'https://ua.example/projects', dir: 'rtl', flippedFrom: 'ltr', lang: 'ar', langTemporary: true, viewportWidth: 1440, viewportHeight: 900, audited: 812 }
);
check('report: title line', report.includes('# RTL audit — UA Projects'));
check('report: url', report.includes('https://ua.example/projects'));
check('report: flip note', report.includes('flipped from ltr'));
check('report: lang temporary', report.includes('lang: ar (temporary)'));
check('report: audited count', report.includes('audited elements: 812'));
check('report: errors section', report.includes('## Errors (1)'));
check('report: warnings section', report.includes('## Warnings (1)'));
check('report: info section', report.includes('## Info (1)'));
check('report: codes present', report.includes('[viewport-overflow]') && report.includes('[truncated]') && report.includes('[physical-align]'));
const emptyReport = C.buildReport([], { title: 'Clean', url: 'https://x' });
check('report: clean page', emptyReport.includes('No RTL issues found'));

// ---------- normalizeDir ----------
eq('dir: rtl', C.normalizeDir('rtl'), 'rtl');
eq('dir: RTL uppercase', C.normalizeDir(' RTL '), 'rtl');
eq('dir: empty → ltr', C.normalizeDir(''), 'ltr');
eq('dir: auto treated as ltr', C.normalizeDir('auto'), 'ltr');
eq('dir: null', C.normalizeDir(null), 'ltr');

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log('FAIL: ' + f);
  process.exit(1);
}
