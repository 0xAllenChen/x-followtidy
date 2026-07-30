(() => {
const CONTENT_VERSION = "0.4.4";
if (globalThis.__clearFollowContentVersion === CONTENT_VERSION) return;
globalThis.__clearFollowContentVersion = CONTENT_VERSION;
const run = {
  stopRequested: false,
  running: false,
  resumable: false,
  settings: null,
  rules: null,
  phase: "idle",
  seen: new Set(),
  candidates: new Map(),
  processed: new Set(),
  checked: 0,
  expectedFollowing: null,
  attempted: 0,
  unfollowed: 0,
  nextActionAt: 0,
  pacingMode: null,
  pauseKind: null,
  pauseMessage: null,
  pausedHandle: null,
  workPageHidden: false
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = (status) => {
  try {
    const message = chrome.runtime.sendMessage({ type: "run-status", status });
    if (message?.catch) message.catch(() => {});
  } catch {
    // The extension may be reloaded while the X tab is still open.
  }
};

async function waitInterruptible(milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!run.stopRequested && Date.now() < deadline) {
    await sleep(Math.min(250, deadline - Date.now()));
  }
}

function isFollowingPage() {
  return /^\/[^/]+\/following\/?$/.test(location.pathname);
}

function exactFollowingCountFromPage() {
  const route = location.pathname.match(/^\/([^/]+)\/following\/?$/);
  if (!route) return null;
  const expectedPath = `/${route[1].toLowerCase()}/following`;
  const locale = document.documentElement.lang || navigator.language || "en";
  const links = [...document.querySelectorAll('a[href]')].filter((link) => {
    try {
      return new URL(link.href).pathname.replace(/\/$/, "").toLowerCase() === expectedPath;
    } catch {
      return false;
    }
  });
  for (const link of links) {
    const values = [link.getAttribute("aria-label"), link.getAttribute("title"), link.textContent].filter(Boolean);
    for (const value of values) {
      const normalized = String(value).replace(/[٠-٩۰-۹०-९０-９]/g, "0");
      const compact = /\d[\d.,\s]*\s*(?:k|m|b|万|萬|만|亿|億|ألف|الف|mil|mio|тыс)(?:\b|\.|\s|$)/i.test(normalized);
      if (compact) continue;
      const count = ClearFollowFilters.parseFollowerCount(value, locale);
      if (Number.isInteger(count) && count >= 0) return count;
    }
  }
  return null;
}

async function resolveExpectedFollowingCount() {
  const visibleCount = exactFollowingCountFromPage();
  if (Number.isInteger(visibleCount)) return visibleCount;
  const route = location.pathname.match(/^\/([^/]+)\/following\/?$/);
  if (!route) return null;
  const profilePath = `/${route[1].toLowerCase()}`;
  const profileLink = [...document.querySelectorAll('a[href]')].find((link) => {
    try {
      return new URL(link.href).pathname.replace(/\/$/, "").toLowerCase() === profilePath;
    } catch {
      return false;
    }
  });
  if (!profileLink) return null;
  dispatchHover(profileLink);
  const deadline = Date.now() + 2500;
  let count = null;
  while (Date.now() < deadline && !run.stopRequested) {
    await sleep(100);
    count = exactFollowingCountFromPage();
    if (Number.isInteger(count)) break;
  }
  profileLink.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, view: window }));
  return Number.isInteger(count) ? count : null;
}

function handleFromCell(cell) {
  const link = [...cell.querySelectorAll('a[href^="/"]')].find((candidate) =>
    /^\/[A-Za-z0-9_]{1,15}$/.test(new URL(candidate.href).pathname)
  );
  return link ? new URL(link.href).pathname.slice(1) : null;
}

function userCells() {
  return [...document.querySelectorAll('[data-testid="UserCell"]')];
}

function followingScrollTarget() {
  let element = userCells().at(-1)?.parentElement;
  while (element && element !== document.body && element !== document.documentElement) {
    const style = getComputedStyle(element);
    if (element.scrollHeight > element.clientHeight + 80 && /(auto|scroll)/.test(style.overflowY)) return element;
    element = element.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function followingListPosition() {
  const target = followingScrollTarget();
  const isDocument = target === document.scrollingElement || target === document.documentElement || target === document.body;
  const top = isDocument ? window.scrollY || target.scrollTop : target.scrollTop;
  const height = isDocument ? window.innerHeight : target.clientHeight;
  const maximum = Math.max(0, target.scrollHeight - height);
  const lastCell = userCells().at(-1);
  const lastBottom = lastCell?.getBoundingClientRect().bottom ?? Infinity;
  const viewportBottom = isDocument ? window.innerHeight : target.getBoundingClientRect().bottom;
  return {
    target,
    isDocument,
    top,
    atEnd: maximum - top <= 250 && lastBottom <= viewportBottom + 300
  };
}

function advanceFollowingList() {
  const cells = userCells();
  const lastCell = cells.at(-1);
  const position = followingListPosition();
  const viewportHeight = position.isDocument ? window.innerHeight : position.target.clientHeight;
  const step = Math.max(700, Math.round(viewportHeight * 0.9));
  const targetRect = position.isDocument ? { top: 0 } : position.target.getBoundingClientRect();
  const lastBottom = lastCell
    ? position.top + lastCell.getBoundingClientRect().bottom - targetRect.top
    : position.top + step;
  const desiredTop = Math.max(position.top + step, lastBottom - viewportHeight * 0.75);
  if (position.isDocument) {
    position.target.scrollTop = desiredTop;
    window.scrollTo({ top: desiredTop, behavior: "auto" });
  } else {
    position.target.scrollTop = desiredTop;
    position.target.dispatchEvent(new Event("scroll", { bubbles: true }));
  }
  return { before: position.top, requested: desiredTop };
}

async function advanceFollowingListAndWait(waitMilliseconds = 1400) {
  const movement = advanceFollowingList();
  await waitInterruptible(waitMilliseconds);
  return movement;
}

function cellFor(handle) {
  return userCells().find((cell) => handleFromCell(cell)?.toLowerCase() === handle.toLowerCase());
}

function accountFromCell(cell) {
  const handle = handleFromCell(cell);
  if (!handle) return null;
  const lines = cell.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
  const handleIndex = lines.findIndex((line) => line.toLowerCase() === `@${handle}`.toLowerCase());
  return {
    handle,
    displayName: handleIndex > 0 ? lines[handleIndex - 1] : handle,
    avatar: cell.querySelector('img[src]')?.src || null,
    visibleFollowsYou: followsYouMarker(cell.innerText)
  };
}

function followsYouMarker(text) {
  return /Follows you|关注了你|正在关注你|关注你|Te sigue|Segue você|Segue-te|フォローされています|팔로우합니다|فالو می‌کند/i.test(text);
}

function canConfirmNoFollowMarker() {
  const language = (document.documentElement.lang || navigator.language || "").toLowerCase();
  return /^(en|zh|es|pt|ja|ko|fa)(-|$)/.test(language);
}

function hoverCardFor(handle) {
  const expected = `/${handle.toLowerCase()}`;
  return [...document.querySelectorAll('[data-testid="HoverCard"], [role="dialog"]')].find((card) =>
    [...card.querySelectorAll('a[href]')].some((link) => new URL(link.href).pathname.toLowerCase() === expected)
  );
}

function dispatchHover(element) {
  for (const type of ["pointerover", "mouseover", "mouseenter"]) {
    const EventClass = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventClass(type, { bubbles: true, cancelable: true, view: window }));
  }
}

async function inspectAccount(account) {
  const cell = cellFor(account.handle);
  if (!cell) return null;
  const expectedPath = `/${account.handle.toLowerCase()}`;
  const profileLinks = [...cell.querySelectorAll('a[href]')].filter((link) =>
    new URL(link.href).pathname.toLowerCase() === expectedPath
  );
  if (!profileLinks.length) return null;

  let card = null;
  for (const profileLink of profileLinks) {
    dispatchHover(profileLink);
    for (let attempt = 0; attempt < 24 && !card && !run.stopRequested; attempt++) {
      await sleep(150);
      card = hoverCardFor(account.handle);
    }
    if (card) break;
  }
  if (!card || run.stopRequested) return null;

  const followerLinks = [...card.querySelectorAll('a[href]')].filter((link) => {
    const path = new URL(link.href).pathname.toLowerCase().replace(/\/$/, "");
    return path === `${expectedPath}/followers` || path === `${expectedPath}/verified_followers`;
  });
  if (!followerLinks.length) return null;

  const locale = document.documentElement.lang || navigator.language || "en";
  const countCandidates = followerLinks.flatMap((link) => [
    link.getAttribute("aria-label"),
    link.getAttribute("title"),
    link.innerText,
    link.textContent
  ]).filter(Boolean);
  const followers = countCandidates
    .map((text) => ClearFollowFilters.parseFollowerCount(text, locale))
    .find(Number.isFinite);

  const cardBelongsToAccount = [...card.querySelectorAll('a[href]')].some((link) =>
    new URL(link.href).pathname.toLowerCase() === expectedPath
  );
  const followedBy = followsYouMarker(`${cell.innerText}\n${card.innerText}`)
    ? true
    : canConfirmNoFollowMarker() ? false : null;

  for (const profileLink of profileLinks) {
    profileLink.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true, view: window }));
  }
  await sleep(120);

  if (!cardBelongsToAccount || !Number.isFinite(followers)) return null;
  return {
    verifiedHandle: account.handle,
    followers,
    followedBy,
    source: "x-hover-card",
    verifiedAt: Date.now()
  };
}

function safeCandidate(account) {
  if (!account.verification) return false;
  const belowCap = ClearFollowFilters.isBelowFollowerCap({
    handle: account.handle,
    verifiedHandle: account.verification.verifiedHandle,
    followers: account.verification.followers,
    cap: run.rules.followerCap,
    source: account.verification.source
  });
  if (!belowCap) return false;
  if (run.rules.skipFollowers && account.verification.followedBy !== false) return false;
  return true;
}

function scannedUserRecord(account, result) {
  const verification = account.verification;
  return {
    handle: account.handle,
    displayName: account.displayName,
    avatar: account.avatar,
    followers: verification?.followers ?? null,
    followsYou: verification?.followedBy ?? (account.visibleFollowsYou ? true : null),
    followerCap: run.rules.followerCap,
    result,
    unfollowed: result === "unfollowed",
    scannedAt: Date.now()
  };
}

function unfollowButtonFor(handle) {
  const cell = cellFor(handle);
  if (!cell) return null;
  const buttons = [...cell.querySelectorAll("button")];
  return buttons.find((button) => /-unfollow$/i.test(button.dataset.testid || ""))
    || buttons.find((button) => /Following|正在关注|已关注|关注中|フォロー中|Siguiendo|Seguindo|Abonné|Abonniert/i.test(
      `${button.innerText} ${button.getAttribute("aria-label") || ""}`
    ));
}

function visibleActionAlerts() {
  return [...document.querySelectorAll('[data-testid="toast"], [role="alert"], [aria-live="assertive"]')]
    .map((element) => element.innerText?.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function looksLikeRateLimit(text) {
  return /rate.?limit|too many (?:requests|actions)|try again later|unable to (?:un)?follow|temporar(?:ily|y)|limit exceeded|操作过于频繁|请求过多|稍后再试|暂时无法|达到.{0,8}上限|频率限制|操作受限|demasiad|inténtalo más tarde|réessayez plus tard|trop de demandes|zu viele|später erneut|しばらくして|制限|나중에 다시|너무 많은|حاول مرة أخرى لاحق/i.test(text);
}

async function unfollowVerifiedAccount(account) {
  // Final safety gate immediately before the destructive click.
  if (!safeCandidate(account)) return { outcome: "safety-check-failed" };
  const button = unfollowButtonFor(account.handle);
  if (!button) return { outcome: "following-button-not-found" };
  const alertsBefore = new Set(visibleActionAlerts());
  button.click();
  await sleep(350);
  const confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]');
  if (!confirm) return { outcome: "confirmation-not-found" };
  // Re-check the immutable verification snapshot before confirming.
  if (!safeCandidate(account)) return { outcome: "safety-check-failed" };
  confirm.click();
  let successObservedAt = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    await sleep(250);
    const newAlert = visibleActionAlerts().find((text) => !alertsBefore.has(text));
    if (newAlert && looksLikeRateLimit(newAlert)) return { outcome: "rate-limited", detail: newAlert };
    if (newAlert && /wrong|failed|error|try again|无法|失败|错误|重试|問題|エラー/i.test(newAlert)) {
      return { outcome: "action-rejected", detail: newAlert };
    }
    const cell = cellFor(account.handle);
    if (!cell || !unfollowButtonFor(account.handle)) {
      successObservedAt ||= Date.now();
      if (Date.now() - successObservedAt >= 1000) return { outcome: "done" };
    } else {
      successObservedAt = 0;
    }
  }
  return { outcome: "action-rejected", detail: "X kept this account in the Following state after confirmation." };
}

function status(message, extra = {}) {
  const queued = [...run.candidates.keys()].filter((key) => !run.processed.has(key)).length;
  report({
    running: run.running,
    streaming: run.resumable || run.running,
    checked: run.checked,
    completed: run.attempted,
    unfollowed: run.unfollowed,
    total: 0,
    followerCap: run.rules?.followerCap,
    expectedFollowing: run.expectedFollowing,
    phase: run.phase,
    queued,
    pauseKind: run.pauseKind,
    pausedHandle: run.pausedHandle,
    workPageHidden: run.workPageHidden,
    nextActionAt: run.nextActionAt,
    pacingMode: run.pacingMode,
    waitingUntil: null,
    message,
    ...extra
  });
}

function scheduleNextAction() {
  const batchComplete = run.unfollowed > 0 && run.unfollowed % run.settings.batchSize === 0;
  run.pacingMode = batchComplete ? "cooldown" : "delay";
  const waitMilliseconds = batchComplete
    ? run.settings.cooldownMinutes * 60_000
    : run.settings.delaySeconds * 1000;
  run.nextActionAt = Date.now() + waitMilliseconds;
}

function nextActionMessage() {
  const remainingSeconds = Math.max(0, Math.ceil((run.nextActionAt - Date.now()) / 1000));
  return remainingSeconds > 0 ? ` Next unfollow in ${remainingSeconds}s.` : "";
}

function protectedResult(account) {
  if (!account.verification) return { result: "unverified", reason: "follower count could not be verified" };
  if (account.verification.followers >= run.rules.followerCap) {
    return { result: "above-limit", reason: `${account.verification.followers.toLocaleString()} followers is above your limit` };
  }
  if (run.rules.skipFollowers && account.verification.followedBy === true) {
    return { result: "follows-you", reason: "this account follows you" };
  }
  if (run.rules.skipFollowers && account.verification.followedBy == null) {
    return { result: "relationship-unknown", reason: "follow-back status could not be verified" };
  }
  return { result: "unverified", reason: "safety verification failed" };
}

async function scanPhase() {
  let lastNewAccountAt = Date.now();
  const expectedText = Number.isInteger(run.expectedFollowing) ? ` of ${run.expectedFollowing.toLocaleString()}` : "";
  status(`Checking your Following list against the ${run.rules.followerCap.toLocaleString()} follower limit… 0${expectedText} checked.`);
  while (!run.stopRequested) {
    if (!isFollowingPage()) throw new Error("The X tab left the Following page. Cleanup stopped.");
    const hasPendingCandidate = [...run.candidates.keys()].some((key) => !run.processed.has(key));
    if (hasPendingCandidate) {
      await processVisibleCandidate({ waitUntilDue: true });
      if (run.stopRequested) break;
    }
    const next = userCells()
      .map(accountFromCell)
      .filter(Boolean)
      .find((account) => !run.seen.has(account.handle.toLowerCase()));
    if (!next) {
      const idleSeconds = Math.floor((Date.now() - lastNewAccountAt) / 1000);
      const movement = await advanceFollowingListAndWait();
      const position = followingListPosition();
      const moved = Math.max(0, position.top - movement.before);
      const progress = Number.isInteger(run.expectedFollowing)
        ? `${run.checked} / ${run.expectedFollowing.toLocaleString()} checked`
        : `${run.checked} checked`;
      status(`Loading more accounts… ${progress} · scrolled ${Math.round(moved)}px · ${idleSeconds}s waiting.${nextActionMessage()}`);
      if (Number.isInteger(run.expectedFollowing) && run.checked >= run.expectedFollowing) break;
      if (Date.now() - lastNewAccountAt >= 90_000) {
        run.stopRequested = true;
        run.pauseKind = "scan-stalled";
        const target = Number.isInteger(run.expectedFollowing) ? ` of ${run.expectedFollowing.toLocaleString()}` : "";
        run.pauseMessage = `X stopped loading new Following accounts after ${run.checked}${target} were checked. Cleanup paused instead of falsely reporting Finished.`;
        break;
      }
      continue;
    }
    lastNewAccountAt = Date.now();
    const key = next.handle.toLowerCase();
    run.seen.add(key);
    run.checked++;
    status(`Checking @${next.handle} (${run.checked} accounts)…`);
    next.verification = await inspectAccount(next);
    if (run.stopRequested) break;
    if (safeCandidate(next)) {
      run.candidates.set(key, next);
      status(`@${next.handle} is eligible. Preparing to unfollow before continuing the scan.`, { scannedUser: scannedUserRecord(next, "queued") });
      await processVisibleCandidate({ waitUntilDue: true });
      if (run.stopRequested) break;
    } else {
      const protectedState = protectedResult(next);
      status(`Kept @${next.handle}: ${protectedState.reason}.`, { scannedUser: scannedUserRecord(next, protectedState.result) });
    }
    const remainingLoaded = userCells()
      .map(accountFromCell)
      .filter(Boolean)
      .filter((account) => !run.seen.has(account.handle.toLowerCase())).length;
    if (remainingLoaded <= 2 && !run.stopRequested) {
      await advanceFollowingListAndWait(900);
    }
    if (Number.isInteger(run.expectedFollowing) && run.checked >= run.expectedFollowing) break;
  }
}

async function processVisibleCandidate({ waitUntilDue }) {
  if (run.stopRequested) return "stopped";
  if (Date.now() < run.nextActionAt) {
    if (!waitUntilDue) return "not-due";
    status("Waiting before the next unfollow.", { waitingUntil: run.nextActionAt });
    await waitInterruptible(run.nextActionAt - Date.now());
    if (run.stopRequested) return "stopped";
  }

  const visibleCandidate = userCells()
    .map(accountFromCell)
    .filter(Boolean)
    .find((account) => run.candidates.has(account.handle.toLowerCase()) && !run.processed.has(account.handle.toLowerCase()));
  if (!visibleCandidate) return "not-found";

  const key = visibleCandidate.handle.toLowerCase();
  const candidate = { ...run.candidates.get(key), ...visibleCandidate };
  status(`Rechecking @${candidate.handle} before unfollowing…`);
  candidate.verification = await inspectAccount(candidate);
  if (run.stopRequested) return "stopped";
  run.processed.add(key);
  if (!safeCandidate(candidate)) {
    const protectedState = protectedResult(candidate);
    status(`Kept @${candidate.handle}: ${protectedState.reason}.`, { scannedUser: scannedUserRecord(candidate, protectedState.result) });
    return "processed";
  }

  status(`Unfollowing @${candidate.handle} · ${candidate.verification.followers.toLocaleString()} followers…`);
  const result = await unfollowVerifiedAccount(candidate);
  const outcome = result.outcome;
  run.attempted++;
  if (outcome === "done") {
    run.unfollowed++;
    scheduleNextAction();
  }
  if (outcome === "rate-limited" || outcome === "action-rejected") {
    run.processed.delete(key);
    run.stopRequested = true;
    run.pauseKind = outcome;
    run.pausedHandle = candidate.handle;
    run.pauseMessage = outcome === "rate-limited"
      ? `X limited unfollow actions at @${candidate.handle}. Cleanup paused automatically. Wait before continuing.`
      : `X did not accept the unfollow for @${candidate.handle}. Cleanup paused automatically.`;
  }
  status(outcome === "done" ? `Unfollowed @${candidate.handle}.` : `Skipped @${candidate.handle}: ${outcome}.`, {
    scannedUser: scannedUserRecord(candidate, outcome === "done" ? "unfollowed" : outcome),
    activity: {
      handle: candidate.handle,
      displayName: candidate.displayName,
      avatar: candidate.avatar,
      followers: candidate.verification.followers,
      followerCap: run.rules.followerCap,
      outcome,
      detail: result.detail || null,
      at: Date.now()
    }
  });
  return "processed";
}

async function unfollowPhase() {
  window.scrollTo({ top: 0, behavior: "instant" });
  await waitInterruptible(700);
  let lastCandidateAt = Date.now();
  status(`Finishing the remaining cleanup queue…`);
  while (!run.stopRequested) {
    if (!isFollowingPage()) throw new Error("The X tab left the Following page. Cleanup stopped.");
    const remaining = [...run.candidates.keys()].filter((key) => !run.processed.has(key)).length;
    if (remaining === 0) break;

    const result = await processVisibleCandidate({ waitUntilDue: true });
    if (result === "processed") {
      lastCandidateAt = Date.now();
      continue;
    }
    if (result === "stopped") break;
    await advanceFollowingListAndWait();
    if (followingListPosition().atEnd && Date.now() - lastCandidateAt >= 30_000) break;
    if (Date.now() - lastCandidateAt >= 90_000) {
      run.stopRequested = true;
      run.pauseKind = "scan-stalled";
      run.pauseMessage = "A waiting candidate could not be loaded again. Cleanup paused with that candidate preserved.";
      break;
    }
  }
}

async function runPipeline({ resume = false } = {}) {
  if (run.running) return;
  run.running = true;
  run.resumable = true;
  run.stopRequested = false;
  if (resume) {
    run.pauseKind = null;
    run.pauseMessage = null;
    run.pausedHandle = null;
    run.workPageHidden = false;
  }
  let finalMessage = "";
  try {
    if (!resume) {
      run.phase = "scan";
      run.seen = new Set();
      run.candidates = new Map();
      run.processed = new Set();
      run.checked = 0;
      run.expectedFollowing = null;
      run.attempted = 0;
      run.unfollowed = 0;
      run.nextActionAt = 0;
      run.pacingMode = null;
      run.pauseKind = null;
      run.pauseMessage = null;
      run.pausedHandle = null;
      run.workPageHidden = false;
      window.scrollTo({ top: 0, behavior: "instant" });
      await waitInterruptible(700);
      run.expectedFollowing = await resolveExpectedFollowingCount();
      if (run.expectedFollowing === 0 && userCells().length > 0) run.expectedFollowing = null;
    }
    if (run.phase === "scan") {
      await scanPhase();
      if (!run.stopRequested) run.phase = "unfollow";
    }
    if (run.phase === "unfollow" && !run.stopRequested) await unfollowPhase();

    if (run.stopRequested) {
      finalMessage = run.pauseMessage || `Paused. ${run.checked} checked; ${run.unfollowed} unfollowed.`;
    } else {
      run.phase = "done";
      run.resumable = false;
      finalMessage = `Finished. ${run.checked} checked; ${run.unfollowed} accounts unfollowed.`;
    }
  } catch (error) {
    run.resumable = false;
    finalMessage = error.message || "Cleanup stopped safely.";
  } finally {
    run.running = false;
    status(finalMessage);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-content-version") {
    sendResponse({ version: CONTENT_VERSION });
  }

  if (message.type === "start-filtered-unfollow") {
    if (!isFollowingPage()) {
      sendResponse({ error: "Open https://x.com/following and wait for your Following list to load." });
      return;
    }
    const cap = Number(message.rules?.followerCap);
    if (!Number.isFinite(cap) || cap <= 0) {
      sendResponse({ error: "A valid follower limit is required." });
      return;
    }
    run.rules = { skipFollowers: message.rules.skipFollowers !== false, useFollowerCap: true, followerCap: cap };
    run.settings = {
      delaySeconds: Math.max(1, Number(message.settings?.delaySeconds) || 8),
      batchSize: Math.max(1, Number(message.settings?.batchSize) || 10),
      cooldownMinutes: Math.max(1, Number(message.settings?.cooldownMinutes) || 5)
    };
    runPipeline();
    sendResponse({ ok: true });
  }

  if (message.type === "stop-unfollow") {
    run.stopRequested = true;
    sendResponse({ ok: true });
  }

  if (message.type === "resume-unfollow") {
    if (run.running) {
      sendResponse({ error: "Pause is still being completed. Try Continue again in a moment." });
      return;
    }
    if (!run.resumable || !run.rules || !run.settings) {
      sendResponse({ error: "There is no paused cleanup session to continue." });
      return;
    }
    runPipeline({ resume: true });
    sendResponse({ ok: true });
  }

  if (message.type === "update-settings") {
    if (!run.settings || !run.rules) {
      sendResponse({ error: "There is no active cleanup session." });
      return;
    }
    const cap = Number(message.rules?.followerCap ?? run.rules.followerCap);
    if (!Number.isFinite(cap) || cap <= 0) {
      sendResponse({ error: "A valid follower limit is required." });
      return;
    }
    run.settings = {
      delaySeconds: Math.max(1, Number(message.settings?.delaySeconds) || run.settings.delaySeconds),
      batchSize: Math.max(1, Number(message.settings?.batchSize) || run.settings.batchSize),
      cooldownMinutes: Math.max(1, Number(message.settings?.cooldownMinutes) || run.settings.cooldownMinutes)
    };
    run.rules = { ...run.rules, ...message.rules, useFollowerCap: true, followerCap: cap };
    sendResponse({ ok: true });
  }
});
})();
