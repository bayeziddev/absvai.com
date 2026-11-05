// The customer's invoice page: "Download" opens the print dialog, where "Save as PDF" keeps a copy.
document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
