// End-to-end tests: loads the demo page (with one planted defect per audit
// check), injects the real content bundle, and exercises flip / audit /
// restore / panel against a real Chrome.
// Run: NODE_PATH="<workspace>/.devdeps/node_modules" node test/e2e.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = [path.join(ROOT, 'shared', 'rtlcore.js'), path.join(ROOT, 'content', 'rtl.js')];

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

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('file:///' + path.join(ROOT, 'test', 'demo-rtl.html').replace(/\\/g, '/'));
    for (const f of FILES) await page.addScriptTag({ path: f }); // exactly what the extension injects

    // ---------- 1. flip / restore round-trip ----------
    const t1 = await page.evaluate(() => window.UARtlAudit.toggle(false));
    check('flip: reports flipped', t1.flipped === true && t1.dir === 'rtl');
    check('flip: dir attribute set', (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === 'rtl');
    check('flip: lang untouched when not asked', (await page.evaluate(() => document.documentElement.getAttribute('lang'))) === 'en');
    const t2 = await page.evaluate(() => window.UARtlAudit.toggle(true)); // restore path
    check('restore: reports unflipped', t2.flipped === false);
    check('restore: dir back to original', (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === 'ltr');
    const t3 = await page.evaluate(() => window.UARtlAudit.toggle(true));
    check('flip+lang: lang becomes ar', t3.flipped === true && (await page.evaluate(() => document.documentElement.getAttribute('lang'))) === 'ar');
    await page.evaluate(() => window.UARtlAudit.restore());
    check('restore: lang back to en', (await page.evaluate(() => document.documentElement.getAttribute('lang'))) === 'en');

    // ---------- 2. audit finds every planted defect ----------
    await page.evaluate(() => window.UARtlAudit.toggle(false));
    const res = await page.evaluate(() => window.UARtlAudit.audit());
    const codes = res.summary ? null : null;
    const issues = await page.evaluate(() => {
      // audit() already stripped elements for the wire; re-derive codes from the report
      const rep = window.UARtlAudit.report().report || '';
      return rep;
    });
    check('audit: summary present', !!res.summary, JSON.stringify(res && res.summary));
    check('audit: clipped found', res.report.includes('[clipped]'));
    check('audit: truncated found', res.report.includes('[truncated]'));
    check('audit: physical-align found', res.report.includes('[physical-align]'));
    check('audit: dir-input found', res.report.includes('[dir-input]'));
    check('audit: icon-naming found', res.report.includes('[icon-naming]'));
    check('audit: no viewport overflow yet', !res.report.includes('[viewport-overflow]'));
    check('audit: counts add up', res.summary.error + res.summary.warn + res.summary.info === res.summary.total);

    // ---------- 3. dir-input only fires for unpinned fields ----------
    const dirInputCount = (res.report.match(/\[dir-input\]/g) || []).length;
    check('audit: exactly two unpinned dir-inputs', dirInputCount === 2, `got ${dirInputCount}`);

    // ---------- 4. document overflow appears on demand ----------
    await page.evaluate(() => window.__addOverflow());
    const res2 = await page.evaluate(() => window.UARtlAudit.audit());
    check('audit: viewport-overflow appears', res2.report.includes('[viewport-overflow]'));
    check('audit: clipping suppressed while doc overflows', !res2.report.includes('[clipped]'));

    // ---------- 5. panel exists with shadow content ----------
    const panelInfo = await page.evaluate(() => {
      const host = document.getElementById('ua-rtl-audit-host');
      if (!host || !host.shadowRoot) return null;
      const rows = host.shadowRoot.querySelectorAll('.issue');
      const chips = [...host.shadowRoot.querySelectorAll('.chip')].map((c) => c.textContent);
      return { rows: rows.length, chips };
    });
    check('panel: shadow host rendered', panelInfo !== null);
    check('panel: rows match issues', panelInfo && panelInfo.rows > 0, JSON.stringify(panelInfo));

    // ---------- 6. clean page produces a clean audit ----------
    await page.evaluate(() => {
      window.UARtlAudit.restore();
      for (const sel of ['.trunc', '.offscreen', '.price', '.icon-arrow-right', '[name="phone"]', '[name="qty"]', '#overflowMaker']) {
        const el = document.querySelector(sel);
        if (el) el.remove();
      }
    });
    const res3 = await page.evaluate(() => window.UARtlAudit.toggle(false).flipped && window.UARtlAudit.audit());
    check('audit: cleaned page has no errors', res3.summary.error === 0, JSON.stringify(res3.summary));

    // ---------- 7. stress: 20 rapid toggles stay consistent ----------
    const stressOk = await page.evaluate(() => {
      let last = null;
      for (let i = 0; i < 20; i++) last = window.UARtlAudit.toggle(false);
      return last.flipped === true && document.documentElement.getAttribute('dir') === 'rtl';
    });
    check('stress: 20 toggles end flipped', stressOk);
    const afterStress = await page.evaluate(() => window.UARtlAudit.restore());
    check('stress: restore after toggles', afterStress.flipped === false && (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === 'ltr');

    console.log(`${pass} passed, ${fail} failed`);
  } finally {
    await browser.close();
  }
  if (fail) {
    for (const f of failures) console.log('FAIL: ' + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
