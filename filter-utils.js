(function (root, factory) {
  const api = factory();
  root.ClearFollowFilters = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalizeDigits(value, locale) {
    let text = String(value || "")
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[०-९]/g, (digit) => String("०१२३४५६७८९".indexOf(digit)))
      .replace(/[０-９]/g, (digit) => String("０１２３４５６７８９".indexOf(digit)));
    const formatter = new Intl.NumberFormat(locale, { useGrouping: false });
    for (let digit = 0; digit <= 9; digit++) {
      const localized = formatter.formatToParts(digit).find((part) => part.type === "integer")?.value;
      if (localized) text = text.split(localized).join(String(digit));
    }
    return text;
  }

  function parseFollowerCount(value, locale = "en") {
    let text = normalizeDigits(value, locale);
    const regularFormatter = new Intl.NumberFormat(locale);
    const decimal = regularFormatter.formatToParts(1.1).find((part) => part.type === "decimal")?.value;
    const groups = new Set(regularFormatter.formatToParts(1234567).filter((part) => part.type === "group").map((part) => part.value));
    if (decimal !== ",") groups.add(",");
    if (decimal !== "٬") groups.add("٬");
    for (const group of groups) text = text.split(group).join("");
    for (const separator of [decimal, "٫"]) {
      if (separator && separator !== ".") text = text.split(separator).join(".");
    }
    text = text.replace(/[\u200e\u200f\u061c]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

    const multipliers = new Map([
      ["k", 1e3], ["m", 1e6], ["b", 1e9],
      ["万", 1e4], ["萬", 1e4], ["만", 1e4],
      ["亿", 1e8], ["億", 1e8], ["ألف", 1e3], ["الف", 1e3]
    ]);
    const compactFormatter = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    for (const magnitude of [1e3, 1e4, 1e6, 1e8, 1e9, 1e12]) {
      const token = compactFormatter.formatToParts(magnitude).find((part) => part.type === "compact")?.value
        ?.replace(/[\u200e\u200f\u061c]/g, "").trim().toLowerCase();
      if (token && !multipliers.has(token)) multipliers.set(token, magnitude);
    }

    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const suffixText = text.slice(match.index + match[0].length).trim();
    const suffix = [...multipliers.keys()].sort((a, b) => b.length - a.length).find((token) => suffixText.startsWith(token));
    const number = Number(match[1]) * (multipliers.get(suffix) || 1);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function isBelowFollowerCap({ handle, verifiedHandle, followers, cap, source }) {
    return source === "x-hover-card"
      && typeof handle === "string"
      && handle.toLowerCase() === String(verifiedHandle || "").toLowerCase()
      && Number.isFinite(followers)
      && Number.isFinite(cap)
      && cap > 0
      && followers < cap;
  }

  return { parseFollowerCount, isBelowFollowerCap };
});
