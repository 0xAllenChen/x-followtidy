const $ = (selector) => document.querySelector(selector);

function isFollowingUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "x.com" && /^\/[^/]+\/following\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

chrome.storage.local.get(["settings", "rules"]).then(({ settings, rules }) => {
  if (rules) {
    $("#skip-followers").checked = rules.skipFollowers !== false;
    if (rules.followerCap) $("#follower-cap").value = String(rules.followerCap);
  }
  if (settings) {
    if (settings.delaySeconds) $("#delay").value = String(settings.delaySeconds);
    if (settings.batchSize) $("#batch").value = String(settings.batchSize);
    if (settings.cooldownMinutes) $("#cooldown").value = String(settings.cooldownMinutes);
  }
});

$("#start").addEventListener("click", async () => {
  const rules = {
    skipFollowers: $("#skip-followers").checked,
    useFollowerCap: true,
    followerCap: +$("#follower-cap").value
  };
  const settings = { delaySeconds: +$("#delay").value, batchSize: +$("#batch").value, cooldownMinutes: +$("#cooldown").value };
  try {
    if (!Number.isFinite(rules.followerCap) || rules.followerCap <= 0) throw new Error("Choose a valid follower limit.");
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const needsFollowingPage = !isFollowingUrl(activeTab?.url);
    const tab = needsFollowingPage
      ? await chrome.tabs.create({
          windowId: activeTab?.windowId,
          index: Number.isInteger(activeTab?.index) ? activeTab.index + 1 : undefined,
          url: "about:blank",
          active: false
        })
      : activeTab;
    await chrome.runtime.sendMessage({ type: "prepare-run", tabId: tab.id, rules, settings, navigateToFollowing: needsFollowingPage });
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: "dashboard.html", enabled: true });
    $("#start").disabled = true;
    $("#start").textContent = "Starting…";
    $("#scan-note").classList.remove("error");
    $("#scan-note").textContent = "Starting the safe filtering engine…";
    const launch = chrome.runtime.sendMessage({
      type: "launch-run",
      tabId: tab.id,
      rules,
      settings,
      prepared: true,
      navigateToFollowing: needsFollowingPage
    });
    const panelOpen = chrome.sidePanel.open({ tabId: tab.id });
    if (needsFollowingPage) await chrome.tabs.update(tab.id, { active: true });
    await panelOpen;
    const result = await launch;
    if (result?.error) throw new Error(result.error);
    if (result?.ok !== true) throw new Error("X FollowTidy could not start on the X page.");
    window.close();
  } catch (error) {
    $("#scan-note").classList.add("error");
    $("#scan-note").textContent = `Couldn’t start: ${error.message || "Refresh the X page and try again."}`;
    $("#start").disabled = false;
    $("#start").textContent = "Start cleaning";
  }
});
