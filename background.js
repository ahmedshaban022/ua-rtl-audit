// Service worker: wires the toolbar command, context menu, and popup to
// the flip/audit actions, and keeps the per-tab "RTL" badge in sync. No
// state is kept here — the page owns its flip state.

import { runInTab } from './shared/inject.js';

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] && tabs[0].id;
}

async function doToggle(langAr) {
  const tabId = await activeTabId();
  if (tabId == null) return null;
  const res = await runInTab(tabId, 'toggle', langAr).catch(() => null);
  if (res) setBadge(tabId, !!res.flipped);
  return res;
}

async function doAudit() {
  const tabId = await activeTabId();
  if (tabId == null) return null;
  return runInTab(tabId, 'audit').catch(() => null);
}

async function doState() {
  const tabId = await activeTabId();
  if (tabId == null) return null;
  return runInTab(tabId, 'state').catch(() => null);
}

async function doReport() {
  const tabId = await activeTabId();
  if (tabId == null) return null;
  return runInTab(tabId, 'report').catch(() => null);
}

function setBadge(tabId, flipped) {
  chrome.action.setBadgeText({ tabId, text: flipped ? 'RTL' : '' }).catch(() => null);
}

chrome.runtime.onInstalled.addListener(() => {
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

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-rtl') {
    chrome.storage.sync.get({ langAr: false }).then(({ langAr }) => doToggle(langAr));
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'ua-rtl-toggle') {
    chrome.storage.sync.get({ langAr: false }).then(({ langAr }) => doToggle(langAr));
  }
  if (info.menuItemId === 'ua-rtl-audit') doAudit();
});

// A navigation discards the page's flip state — drop its badge so the two
// never disagree.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') setBadge(tabId, false);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return undefined;
  const run = (p) => p.then(sendResponse).catch(() => sendResponse(null));
  if (msg.type === 'ua-rtl:toggle') {
    run(doToggle(msg.langAr));
    return true;
  }
  if (msg.type === 'ua-rtl:audit') {
    run(doAudit());
    return true;
  }
  if (msg.type === 'ua-rtl:state') {
    run(doState());
    return true;
  }
  if (msg.type === 'ua-rtl:report') {
    run(doReport());
    return true;
  }
  return undefined;
});
