const $ = (selector) => document.querySelector(selector);
const PAGE_SIZE = 10;
let initializedControls = false;
let currentPage = 0;
let latestLog = [];
let donationDismissed = false;
function settingsFromControls() { return { delaySeconds: +$("#delay").value, batchSize: +$("#batch").value, cooldownMinutes: +$("#cooldown").value }; }
function rulesFromControls() { return { skipFollowers: $("#skip-followers").checked, useFollowerCap: true, followerCap: +$("#follower-cap").value }; }
function escapeHtml(value) { return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
function safeImage(url) { try { return new URL(url).protocol === "https:" ? url : ""; } catch { return ""; } }
function formatFollowers(count) { return Number.isFinite(count) ? `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count)} followers` : "followers not verified"; }
function followBackLabel(value) { return value === true ? "Follows you: Yes" : value === false ? "Follows you: No" : "Follows you: Unknown"; }
function liveMessage(status) {
  const deadline = Number.isFinite(status.waitingUntil) ? status.waitingUntil : status.nextActionAt;
  if (Number.isFinite(deadline) && deadline > Date.now() && (status.queued || 0) > 0) {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const timer = status.pacingMode === "cooldown" ? `Batch cooldown: ${seconds}s` : `Next unfollow in ${seconds}s`;
    if (Number.isFinite(status.waitingUntil)) return `Waiting before the next unfollow. ${timer}`;
    return `${status.message || "Working…"} · ${timer}`;
  }
  if (Number.isFinite(status.waitingUntil)) {
    return "Waiting before the next unfollow. Starting shortly…";
  }
  return status.message || "Ready";
}
function resultLabel(result) {
  return ({
    unfollowed: "Unfollowed",
    "above-limit": "Kept · Above limit",
    "follows-you": "Kept · Follows you",
    "relationship-unknown": "Kept · Relationship unknown",
    unverified: "Kept · Unverified",
    queued: "Eligible · Waiting",
    "following-button-not-found": "Skipped · Button unavailable",
    "confirmation-not-found": "Skipped · Confirmation unavailable",
    "safety-check-failed": "Kept · Safety check",
    "rate-limited": "Paused · X rate limit",
    "action-rejected": "Paused · X rejected action"
  })[result] || "Kept";
}
function renderActivity() {
  const pages = Math.max(1, Math.ceil(latestLog.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pages - 1);
  const records = latestLog.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  $("#activity").innerHTML = records.length ? records.map((item) => {
    const profileUrl = `https://x.com/${encodeURIComponent(item.handle)}`;
    const resultClass = item.unfollowed ? "ok" : item.result === "above-limit" || item.result === "follows-you" ? "kept" : "skip";
    return `<div class="entry"><a class="profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer"><img class="avatar" src="${escapeHtml(safeImage(item.avatar))}" alt=""><div class="identity"><b>${escapeHtml(item.displayName || item.handle)}</b><small>@${escapeHtml(item.handle)} · ${escapeHtml(formatFollowers(item.followers))}</small><small>${escapeHtml(followBackLabel(item.followsYou))} · Limit ${escapeHtml(formatFollowers(item.followerCap))}</small></div></a><a class="view-profile" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">View profile →</a><span class="${resultClass}">${escapeHtml(resultLabel(item.result))}<br>${escapeHtml(new Date(item.updatedAt || item.scannedAt).toLocaleString())}</span></div>`;
  }).join("") : '<p class="empty">Scanned users will appear here.</p>';
  $("#page").textContent = `Page ${currentPage + 1} / ${pages}`;
  $("#previous").disabled = currentPage === 0;
  $("#next").disabled = currentPage >= pages - 1;
}
function render(status) {
  const percent = status.total ? Math.round(status.completed / status.total * 100) : 0;
  $("#count").textContent = status.unfollowed || 0;
  const checkedProgress = Number.isInteger(status.expectedFollowing)
    ? `${status.checked || 0} / ${status.expectedFollowing} accounts read`
    : `${status.checked || 0} accounts read`;
  $("#total").textContent = status.streaming ? `${status.unfollowed || 0} unfollowed · ${status.queued || 0} waiting · ${checkedProgress}` : status.total ? `unfollowed · ${status.completed || 0} of ${status.total} processed` : "accounts unfollowed";
  $(".bar i").style.width = `${percent}%`;
  $("#message").textContent = liveMessage(status);
  $("#donation-prompt").classList.toggle("hidden", donationDismissed || !status.running || status.phase !== "scan");
  const automaticallyPaused = ["rate-limited", "action-rejected", "scan-stalled", "worker-closed", "launch-failed"].includes(status.pauseKind);
  $("#state").textContent = status.pauseKind === "worker-closed" ? "WORK TAB CLOSED" : automaticallyPaused ? "ACTION BLOCKED" : status.running ? "WORKING" : "PAUSED / DONE";
  $("#limit-notice").classList.toggle("hidden", !automaticallyPaused);
  $("#limit-detail").textContent = status.pauseKind === "rate-limited"
    ? `X is limiting unfollows${status.pausedHandle ? ` near @${status.pausedHandle}` : ""}. Wait at least 15–30 minutes, or longer if X still blocks the action, then press Continue.`
    : status.pauseKind === "worker-closed"
      ? "The X Following tab was closed, so its in-memory scan queue was lost. Open a Following page and start a new run."
      : status.pauseKind === "launch-failed"
        ? status.message || "X FollowTidy could not start. Refresh the X Following page and try again."
      : status.pauseKind === "scan-stalled"
      ? "X stopped loading more users. The list was not marked complete and the current queue was preserved. Wait briefly, then press Continue."
      : `X did not accept the last unfollow${status.pausedHandle ? ` for @${status.pausedHandle}` : ""}. Check the X tab, wait, then press Continue.`;
  $("#pause").disabled = !status.running;
  $("#resume").disabled = status.running || !status.streaming;
  latestLog = status.scannedUsers || [];
  $("#activity-count").textContent = `${latestLog.length} users`;
  renderActivity();
  if (!initializedControls && status.settings) {
    $("#delay").value = status.settings.delaySeconds || 8;
    $("#batch").value = status.settings.batchSize || 10;
    $("#cooldown").value = status.settings.cooldownMinutes || 5;
    $("#follower-cap").value = status.rules?.followerCap || status.followerCap || 10000;
    $("#skip-followers").checked = status.rules?.skipFollowers !== false;
    initializedControls = true;
  }
}
function refresh() { chrome.runtime.sendMessage({ type: "get-run-status" }, render); }
function control(type, settings, rules) {
  chrome.runtime.sendMessage({ type, settings, rules }, (result) => {
    if (result?.error) $("#message").textContent = result.error;
    else refresh();
  });
}
$("#pause").addEventListener("click", () => control("pause-active-run"));
$("#resume").addEventListener("click", () => control("resume-active-run"));
$("#save").addEventListener("click", () => control("update-active-settings", settingsFromControls(), rulesFromControls()));
function dismissDonation() { donationDismissed = true; $("#donation-prompt").classList.add("hidden"); }
$("#donation-later").addEventListener("click", dismissDonation);
$("#sponsor").addEventListener("click", dismissDonation);
$("#previous").addEventListener("click", () => { currentPage--; renderActivity(); });
$("#next").addEventListener("click", () => { currentPage++; renderActivity(); });
refresh(); setInterval(refresh, 1000);
