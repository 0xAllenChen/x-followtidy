const assert = require("node:assert/strict");
const { parseFollowerCount, isBelowFollowerCap } = require("../filter-utils");

assert.equal(parseFollowerCount("4.8M Followers", "en"), 4_800_000);
assert.equal(parseFollowerCount("1.8M Followers", "en"), 1_800_000);
assert.equal(parseFollowerCount("1,8 Mio. Follower", "de"), 1_800_000);
assert.equal(parseFollowerCount("12.5万 位关注者", "zh-CN"), 125_000);
assert.equal(parseFollowerCount("12 mil seguidores", "es"), 12_000);
assert.equal(parseFollowerCount("12 тыс. читателей", "ru"), 12_000);
assert.equal(parseFollowerCount("١٢٫٥ ألف متابع", "ar"), 12_500);
assert.equal(parseFollowerCount("9,876 Followers", "en"), 9_876);

assert.equal(isBelowFollowerCap({
  handle: "small",
  verifiedHandle: "small",
  followers: 9_999,
  cap: 10_000,
  source: "x-hover-card"
}), true);

for (const unsafeCase of [
  { handle: "ChatGPT", verifiedHandle: "ChatGPT", followers: 4_800_000, cap: 10_000, source: "x-hover-card" },
  { handle: "ChatGPT", verifiedHandle: "Other", followers: 100, cap: 10_000, source: "x-hover-card" },
  { handle: "ChatGPT", verifiedHandle: "ChatGPT", followers: null, cap: 10_000, source: "x-hover-card" },
  { handle: "ChatGPT", verifiedHandle: "ChatGPT", followers: 100, cap: 10_000, source: "raw-html" }
]) {
  assert.equal(isBelowFollowerCap(unsafeCase), false);
}

console.log("filter-utils tests passed");
