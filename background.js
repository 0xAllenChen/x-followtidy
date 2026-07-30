const DEFAULT_STATUS = { running: false, completed: 0, total: 0, message: "Ready" };
const CONTENT_VERSION = "0.4.4";
let statusWrite = Promise.resolve();

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function initialRunStatus(message) {
  return {
    running: true,
    streaming: true,
    completed: 0,
    unfollowed: 0,
    checked: 0,
    total: 0,
    expectedFollowing: null,
    followerCap: message.rules?.followerCap,
    pauseKind: null,
    pausedHandle: null,
    workerOwned: false,
    message: message.navigateToFollowing ? "Opening your X Following page…" : "Loading the safe filtering engine…",
    tabId: message.tabId
  };
}

async function waitForFollowingTab(tabId, timeoutMilliseconds = 45_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    try {
      const url = new URL(tab.url || "");
      if (url.hostname === "x.com" && /^\/[^/]+\/following\/?$/.test(url.pathname) && tab.status === "complete") return tab;
    } catch {
      // Keep waiting while X redirects the new tab.
    }
    await wait(250);
  }
  throw new Error("Could not open your Following list. Make sure you are signed in to X, then try again.");
}

function queueStatus(update, clearLog = false) {
  statusWrite = statusWrite.then(async () => {
    const { runStatus, activityLog = [], unfollowHistory = [], scannedUsers = [] } = await chrome.storage.local.get(["runStatus", "activityLog", "unfollowHistory", "scannedUsers"]);
    const { activity, scannedUser, ...status } = update;
    const stampedActivity = activity ? { ...activity, at: activity.at || Date.now() } : null;
    const nextLog = clearLog ? [] : stampedActivity ? [stampedActivity, ...activityLog].slice(0, 500) : activityLog;
    const nextHistory = stampedActivity?.outcome === "done"
      ? [stampedActivity, ...unfollowHistory].slice(0, 2000)
      : unfollowHistory;
    const stampedUser = scannedUser ? { ...scannedUser, updatedAt: Date.now() } : null;
    const nextScanned = clearLog
      ? []
      : stampedUser
        ? [stampedUser, ...scannedUsers.filter((user) => user.handle?.toLowerCase() !== stampedUser.handle?.toLowerCase())]
        : scannedUsers;
    await chrome.storage.local.set({ runStatus: { ...runStatus, ...status }, activityLog: nextLog, unfollowHistory: nextHistory, scannedUsers: nextScanned });
  });
  return statusWrite;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["settings", "runStatus"]);
  await chrome.storage.local.set({
    settings: existing.settings || { protectedHandles: [], delaySeconds: 8, batchSize: 10, cooldownMinutes: 5 },
    runStatus: existing.runStatus || DEFAULT_STATUS
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get("runStatus").then(({ runStatus }) => {
    if (runStatus?.tabId !== tabId || !runStatus.streaming) return;
    queueStatus({
      running: false,
      streaming: false,
      pauseKind: "worker-closed",
      pausedHandle: null,
      message: "The X FollowTidy tab was closed. This run cannot continue; start a new run."
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  chrome.storage.local.get("runStatus").then(({ runStatus }) => {
    let isFollowing = false;
    try {
      const url = new URL(changeInfo.url);
      isFollowing = url.hostname === "x.com" && (/^\/[^/]+\/following\/?$/.test(url.pathname) || /^\/following\/?$/.test(url.pathname));
    } catch {
      // Non-web and malformed URLs must not retain the X FollowTidy panel.
    }
    const enabled = isFollowing && runStatus?.tabId === tabId && runStatus?.streaming === true;
    chrome.sidePanel.setOptions({
      tabId,
      enabled,
      ...(enabled ? { path: "dashboard.html" } : {})
    }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "prepare-run") {
    chrome.storage.local.set({ settings: message.settings, rules: message.rules })
      .then(() => queueStatus(initialRunStatus(message), true))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message || "Could not prepare X FollowTidy." }));
    return true;
  }
  if (message.type === "launch-run") {
    (async () => {
      if (!message.prepared) {
        await chrome.storage.local.set({ settings: message.settings, rules: message.rules });
        await queueStatus(initialRunStatus(message), true);
      }
      if (message.navigateToFollowing) {
        await chrome.tabs.update(message.tabId, { url: "https://x.com/following" });
      }
      await waitForFollowingTab(message.tabId);
      await queueStatus({ message: "Loading the safe filtering engine…" });
      let current = null;
      try {
        current = await chrome.tabs.sendMessage(message.tabId, { type: "get-content-version" });
      } catch {
        // Inject below when this Following page has no content script yet.
      }
      if (current?.version && current.version !== CONTENT_VERSION) {
        throw new Error("X FollowTidy was updated. Refresh the X Following page once, then start again.");
      }
      if (!current) {
        await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          files: ["filter-utils.js", "content.js"]
        });
        current = await chrome.tabs.sendMessage(message.tabId, { type: "get-content-version" });
      }
      if (current?.version !== CONTENT_VERSION) throw new Error("Could not load X FollowTidy into the X page.");
      const result = await chrome.tabs.sendMessage(message.tabId, {
        type: "start-filtered-unfollow",
        rules: message.rules,
        settings: message.settings
      });
      if (result?.error) throw new Error(result.error);
      if (result?.ok !== true) throw new Error("X did not confirm the cleanup start.");
      sendResponse({ ok: true });
    })().catch(async (error) => {
      const detail = error.message || "Refresh the X Following page and try again.";
      await queueStatus({
        running: false,
        streaming: false,
        pauseKind: "launch-failed",
        message: `Could not start: ${detail}`
      });
      sendResponse({ error: detail });
    });
    return true;
  }
  if (message.type === "run-status") {
    queueStatus(message.status).then(async () => {
      const { runStatus } = await chrome.storage.local.get("runStatus");
      if (runStatus?.workerOwned && runStatus?.tabId && runStatus.running === false && runStatus.streaming === false) {
        chrome.tabs.remove(runStatus.tabId).catch(() => {});
      }
    });
  }
  if (message.type === "scan-status") {
    queueStatus({ running: true, message: message.text });
  }
  if (message.type === "pause-active-run") {
    chrome.storage.local.get("runStatus").then(({ runStatus }) => {
      if (!runStatus?.tabId) { sendResponse({ error: "No active X tab was found." }); return; }
      chrome.tabs.sendMessage(runStatus.tabId, { type: "stop-unfollow" }).then((result) => {
        if (!result?.ok) { sendResponse({ error: "X did not confirm the pause request." }); return; }
        queueStatus({ running: true, message: "Pausing after the current action…" }).then(() => sendResponse({ ok: true }));
      }).catch(() => sendResponse({ error: "Could not reach the X Following tab. Refresh it and start a new run." }));
    });
    return true;
  }
  if (message.type === "resume-active-run" || message.type === "update-active-settings") {
    chrome.storage.local.get("runStatus").then(({ runStatus }) => {
      if (!runStatus?.tabId) { sendResponse({ error: "No active X tab was found." }); return; }
      chrome.tabs.sendMessage(runStatus.tabId, { type: message.type === "resume-active-run" ? "resume-unfollow" : "update-settings", settings: message.settings, rules: message.rules }).then((result) => {
        if (result?.error) { sendResponse(result); return; }
        if (!result?.ok) { sendResponse({ error: "X did not confirm this action." }); return; }
        if (message.settings || message.rules) {
          chrome.storage.local.get(["settings", "rules"]).then(({ settings, rules }) => chrome.storage.local.set({
            settings: { ...settings, ...message.settings },
            rules: { ...rules, ...message.rules, useFollowerCap: true }
          }));
        }
        queueStatus(message.type === "resume-active-run" ? { running: true, message: "Continuing cleanup…" } : { message: "Safety settings updated for remaining accounts." }).then(() => sendResponse({ ok: true }));
      }).catch(() => sendResponse({ error: "Could not reach the X Following tab. Refresh it and start a new run." }));
    });
    return true;
  }
  if (message.type === "get-run-status") {
    statusWrite.then(() => chrome.storage.local.get(["runStatus", "activityLog", "unfollowHistory", "scannedUsers", "settings", "rules"]).then(({ runStatus, activityLog = [], unfollowHistory = [], scannedUsers = [], settings, rules }) => sendResponse({ ...(runStatus || DEFAULT_STATUS), activityLog, unfollowHistory, scannedUsers, settings, rules })));
    return true;
  }
});
