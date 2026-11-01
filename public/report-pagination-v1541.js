// Shared, browser + Node-testable pagination for Don Mac Sales Report v1.5.41.
(function (root) {
  'use strict';
  const PAGE_SIZE = 10;
  function paginate(input, requestedPage = 1, size = PAGE_SIZE) {
    const rows = Array.isArray(input) ? input : [];
    const limit = Math.max(1, Math.floor(Number(size) || PAGE_SIZE));
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const page = Math.min(pages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
    const offset = (page - 1) * limit;
    return {
      rows: rows.slice(offset, offset + limit),
      page, pages, total: rows.length,
      from: rows.length ? offset + 1 : 0,
      to: Math.min(rows.length, offset + limit),
    };
  }
  function visiblePageNumbers(page, totalPages) {
    const total = Math.max(1, Math.floor(Number(totalPages) || 1));
    const selected = Math.min(total, Math.max(1, Math.floor(Number(page) || 1)));
    const numbers = new Set([1, total]);
    if (total <= 8) {
      for (let i = 1; i <= total; i++) numbers.add(i);
    } else {
      numbers.add(2);
      numbers.add(total - 1);
      for (let i = Math.max(1, selected - 1); i <= Math.min(total, selected + 1); i++) numbers.add(i);
    }
    const ordered = [...numbers].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < ordered.length; i++) {
      if (i > 0 && ordered[i] - ordered[i - 1] > 1) result.push('…');
      result.push(ordered[i]);
    }
    return result;
  }
  const api = Object.freeze({ PAGE_SIZE, paginate, visiblePageNumbers });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DonMacReportPages = api;
})(typeof window !== 'undefined' ? window : globalThis);
