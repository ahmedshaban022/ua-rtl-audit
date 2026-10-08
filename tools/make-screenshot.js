// Produces the Chrome Web Store 1280x800 screenshot: the demo page flipped
// to RTL with the real audit panel open.
// Run: NODE_PATH="<workspace>/.devdeps/node_modules" node tools/make-screenshot.js
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'store', 'screenshot-1280x800.png');

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('file:///' + path.join(ROOT, 'test', 'demo-rtl.html').split(path.sep).join('/'), { waitUntil: 'load' });
    for (const f of ['shared/rtlcore.js', 'content/rtl.js']) {
      await page.addScriptTag({ path: path.join(ROOT, f) });
    }
    await page.evaluate(() => window.UARtlAudit.toggle(false));
    await page.evaluate(() => window.UARtlAudit.audit());
    await page.waitForTimeout(300); // panel fade-in settle
    const flipped = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const host = await page.evaluate(() => !!document.getElementById('ua-rtl-audit-host'));
    if (flipped !== 'rtl' || !host) throw new Error('screenshot state wrong: dir=' + flipped + ' host=' + host);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT });
    console.log('store screenshot written:', OUT);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('make-screenshot crashed:', e);
  process.exit(1);
});
