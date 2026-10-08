// Shared injection helper used by the service worker. Injects the audit
// bundle (predicate module first, then the content script) into the tab's
// top frame and invokes an action in the same isolated world. Both files
// are idempotent, so re-injecting before every action is safe.

export const CONTENT_FILES = ['shared/rtlcore.js', 'content/rtl.js'];

export async function runInTab(tabId, action, arg) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_FILES
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (action, arg) =>
      window.UARtlAudit
        ? window.UARtlAudit[action](arg)
        : { error: 'not-loaded' },
    // undefined is not structured-cloneable — null is the neutral arg
    args: [action, arg === undefined ? null : arg]
  });
  const r = results && results[0];
  return r && typeof r.result === 'object' && r.result !== null ? r.result : { error: 'no-result' };
}
