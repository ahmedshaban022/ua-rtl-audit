// Popup logic: reflects the page's flip state, delegates flip/audit to the
// service worker (which owns tab access), and copies the markdown report
// with the popup's own user gesture.
const $ = (id) => document.getElementById(id);

function send(type, extra) {
  return chrome.runtime.sendMessage(Object.assign({ type }, extra || {})).catch(() => null);
}

let lastReport = null;

function renderState(res) {
  const chip = $('state');
  const btn = $('toggle');
  if (!res) {
    chip.textContent = '—';
    chip.className = 'chip ltr';
    return;
  }
  if (res.flipped) {
    chip.textContent = 'RTL';
    chip.className = 'chip rtl';
    btn.textContent = 'Restore LTR';
    btn.className = 'rtl';
  } else {
    chip.textContent = 'LTR';
    chip.className = 'chip ltr';
    btn.textContent = 'Flip to RTL';
    btn.className = '';
  }
}

function renderSummary(res) {
  const el = $('stats');
  if (!res || !res.summary) {
    el.textContent = 'Could not run on this page (try a normal http(s) page).';
    return;
  }
  const s = res.summary;
  el.innerHTML =
    `Found: <b class="err">${s.error}</b> error(s), <b class="warn">${s.warn}</b> warning(s), <b class="info">${s.info}</b> info` +
    (s.total ? '' : ' — clean! 🎉');
}

async function init() {
  const { langAr } = await chrome.storage.sync.get({ langAr: false });
  $('langAr').checked = !!langAr;
  renderState(await send('ua-rtl:state'));
}

$('langAr').addEventListener('change', () => {
  chrome.storage.sync.set({ langAr: $('langAr').checked });
});

$('toggle').addEventListener('click', async () => {
  const res = await send('ua-rtl:toggle', { langAr: $('langAr').checked });
  renderState(res);
  if (res) $('stats').textContent = res.flipped ? 'Flipped to RTL — audit to see what breaks.' : 'Direction restored.';
  else $('stats').textContent = 'Could not run on this page (try a normal http(s) page).';
});

$('audit').addEventListener('click', async () => {
  $('stats').textContent = 'Auditing…';
  const res = await send('ua-rtl:audit');
  renderSummary(res);
  if (res && res.report) {
    lastReport = res.report;
    $('copy').style.display = 'block';
  }
});

$('copy').addEventListener('click', async () => {
  if (!lastReport) return;
  try {
    await navigator.clipboard.writeText(lastReport);
    $('copy').textContent = 'Copied ✓';
  } catch (_) {
    $('copy').textContent = 'Copy failed — use the in-page panel';
  }
  setTimeout(() => ($('copy').textContent = 'Copy markdown report'), 1500);
});

init().catch(() => ($('stats').textContent = 'Popup failed to start — try reopening it.'));
