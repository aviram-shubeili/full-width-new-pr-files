(() => {
  "use strict";

  const TABLE = "table.diff-table, table[data-diff-anchor]";
  const EXPANDED = "fwpr-added-file";
  const HIDDEN = "fwpr-empty-left";
  const originalSpans = new WeakMap();
  const dirtyTables = new Set();
  let pending = null;
  let fullScan = true;
  let previousPath = location.pathname;

  const isPullRequest = () => /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/.test(location.pathname);

  function isAddedSplitFile(table) {
    if (!isPullRequest()) return false;
    const legacy = table.matches(".diff-table");
    if (legacy && !table.matches(".file-diff-split, .js-file-diff-split")) return false;
    // The React renderer has generated class names; use its semantic DOM.
    if (!legacy && table.querySelector(":scope > colgroup")?.children.length !== 4) return false;

    // An additions-only edit to an existing file must keep its original pane.
    // -0,0 is the explicit empty base-file range, independent of UI language.
    const hunks = [...table.querySelectorAll(".blob-code-hunk, .diff-hunk-cell")]
      .filter(cell => cell.closest("table") === table);
    if (!hunks.some(cell => /@@\s+-0,0\s+\+\d+(?:,\d+)?\s+@@/.test(cell.textContent))) return false;
    if (hunks.some(cell => /@@\s+-\d+(?:,\d+)?\s+\+/.test(cell.textContent) &&
      !/@@\s+-0,0\s+\+/.test(cell.textContent))) return false;

    if (!legacy) {
      const rows = [...table.rows].filter(row => row.closest("table") === table &&
        row.matches(".diff-line-row") && row.cells.length === 4);
      return rows.length > 0 && rows.every(row =>
        row.cells[0].matches(".empty-diff-line") && row.cells[1].matches(".empty-diff-line") &&
        row.cells[3].matches(".right-side-diff-cell") &&
        row.cells[3].querySelector(":scope > .addition") !== null);
    }

    const leftCells = [...table.querySelectorAll('[data-split-side="left"]')]
      .filter(cell => cell.closest("table") === table);
    return leftCells.length > 0 && leftCells.every(cell => cell.matches(".blob-code-empty")) &&
      table.querySelector('[data-split-side="right"].blob-code-addition') !== null;
  }

  function setSpan(cell, span) {
    if (cell.colSpan === span) return;
    if (!originalSpans.has(cell)) originalSpans.set(cell, cell.getAttribute("colspan"));
    cell.colSpan = span;
  }

  function restore(table) {
    table.classList.remove(EXPANDED);
    table.querySelectorAll(`.${HIDDEN}`).forEach(cell => cell.classList.remove(HIDDEN));
    table.querySelectorAll("td, th").forEach(cell => {
      if (!originalSpans.has(cell)) return;
      const value = originalSpans.get(cell);
      if (value === null) cell.removeAttribute("colspan");
      else cell.setAttribute("colspan", value);
      originalSpans.delete(cell);
    });
  }

  function expand(table) {
    table.classList.add(EXPANDED);
    for (const row of table.rows) {
      // Leave any nested review-comment tables alone.
      if (row.closest("table") !== table) continue;
      const cells = [...row.cells];
      if (row.matches(".diff-line-row") && cells.length === 4 &&
        cells[0].matches(".empty-diff-line") && cells[1].matches(".empty-diff-line")) {
        cells[0].classList.add(HIDDEN);
        cells[1].classList.add(HIDDEN);
      }
      const left = cells.find(cell => cell.matches('[data-split-side="left"].blob-code-empty'));
      if (left) {
        left.classList.add(HIDDEN);
        const gutter = left.previousElementSibling;
        if (gutter?.matches(".blob-num-empty")) gutter.classList.add(HIDDEN);
      }
      if (row.parentElement === table.tHead && cells.length === 4) {
        cells[0].classList.add(HIDDEN);
        cells[1].classList.add(HIDDEN);
      }
      // Hunk headers and notes use colspans for the original four-column table.
      // Reduce them to the remaining line-number and code columns.
      for (const cell of cells) {
        if (cell.classList.contains(HIDDEN)) continue;
        if (cell.matches(".empty-cell") && cell.colSpan === 2) cell.classList.add(HIDDEN);
        else if (cell.colSpan === 4) setSpan(cell, 2);
        else if (cell.colSpan === 3) setSpan(cell, 1);
      }
    }
  }

  function observe() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-split-side", "colspan"]
    });
  }

  function flush() {
    pending = null;
    if (location.pathname !== previousPath) {
      previousPath = location.pathname;
      fullScan = true;
    }
    const tables = fullScan ? document.querySelectorAll(TABLE) : [...dirtyTables];
    fullScan = false;
    dirtyTables.clear();
    // Our own classes/spans must not trigger a mutation-observer loop.
    observer.disconnect();
    try {
      for (const table of tables) {
        if (!table.isConnected) continue;
        if (isAddedSplitFile(table)) expand(table);
        else if (table.classList.contains(EXPANDED)) restore(table);
      }
    } finally {
      observe();
    }
  }

  function schedule() {
    if (pending === null) pending = setTimeout(flush, 60);
  }

  function collect(node) {
    if (!(node instanceof Element)) return;
    const table = node.closest(TABLE);
    if (table) dirtyTables.add(table);
    node.querySelectorAll(TABLE).forEach(table => dirtyTables.add(table));
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      collect(record.target);
      for (const node of record.addedNodes) collect(node);
    }
    if (dirtyTables.size || location.pathname !== previousPath) schedule();
  });

  for (const event of ["turbo:load", "pjax:end", "popstate"]) {
    document.addEventListener(event, () => { fullScan = true; schedule(); });
  }
  window.addEventListener("popstate", () => { fullScan = true; schedule(); });
  observe();
  schedule();
})();
