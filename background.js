// Service worker: wires the toolbar command, context menu, and popup to
// the flip/audit actions, and keeps the per-tab "RTL" badge in sync. No
// state is kept here — the page owns its flip state.

import { runInTab } from './shared/inject.js';
import { pageTab, requirePage, failure } from './shared/runtime.js';

async function activeTabId(tabId) {
  const tab = await pageTab(tabId);
  requirePage(tab, true);
  return tab.id;
}

async function doToggle(langAr, targetId) {
  const tabId = await activeTabId(targetId);
  if (tabId == null) return null;
  const res = await runInTab(tabId, 'toggle', langAr);
  if (res && !res.error) setBadge(tabId, !!res.flipped);
  return res;
}

async function doAudit(targetId) {
  const tabId = await activeTabId(targetId);
  if (tabId == null) return null;
  return runInTab(tabId, 'audit');
}

async function doState(targetId) {
  const tabId = await activeTabId(targetId);
  if (tabId == null) return null;
  return runInTab(tabId, 'state');
}

async function doReport(targetId) {
  const tabId = await activeTabId(targetId);
  if (tabId == null) return null;
  return runInTab(tabId, 'report');
}

function setBadge(tabId, flipped) {
  chrome.action.setBadgeText({ tabId, text: flipped ? 'RTL' : '' }).catch(() => null);
}

chrome.runtime.onInstalled.addListener(() => {
  // clear first so a create() failure can't leave half the menus registered
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ua-rtl-toggle',
      title: 'Flip direction (LTR ↔ RTL)',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'ua-rtl-audit',
      title: 'Run RTL audit on this page',
      contexts: ['page']
    });
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-rtl') {
    chrome.storage.sync
      .get({ langAr: false })
      .then(({ langAr }) => doToggle(langAr))
      .catch(() => {}); // a sync backend failure just skips this flip
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'ua-rtl-toggle') {
    chrome.storage.sync
      .get({ langAr: false })
      .then(({ langAr }) => doToggle(langAr))
      .catch(() => {}); // a sync backend failure just skips this flip
  }
  if (info.menuItemId === 'ua-rtl-audit') doAudit().catch(console.error);
});

// A navigation discards the page's flip state — drop its badge so the two
// never disagree.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') setBadge(tabId, false);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return undefined;
  const run = (p) => p.then(sendResponse).catch((e) => sendResponse(failure(e)));
  if (msg.type === 'ua-rtl:toggle') {
    run(doToggle(msg.langAr, msg.tabId));
    return true;
  }
  if (msg.type === 'ua-rtl:audit') {
    run(doAudit(msg.tabId));
    return true;
  }
  if (msg.type === 'ua-rtl:state') {
    run(doState(msg.tabId));
    return true;
  }
  if (msg.type === 'ua-rtl:report') {
    run(doReport(msg.tabId));
    return true;
  }
  return undefined;
});
