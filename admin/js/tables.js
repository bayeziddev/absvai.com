// Phones: list tables become one card per row, each value with its column name (admin.css, table.cards). The labels are
// taken from the table head, so every page and slide-over (admin and seller portal) gets this without its own code.
function labelTables(root) {
  root.querySelectorAll('.table-wrap table:not([data-labeled])').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    t.dataset.labeled = '1';
    if (heads.length < 3 || t.classList.contains('no-cards')) return;
    t.classList.add('cards');
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.dataset.label = td.colSpan > 1 ? '' : heads[i] ?? ''; }));
  });
}

export function autoLabelTables() {
  labelTables(document);
  new MutationObserver(() => labelTables(document)).observe(document.body, { childList: true, subtree: true });
}
