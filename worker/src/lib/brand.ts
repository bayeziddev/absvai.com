/**
 * The shop's name wherever the store, emails, SMS, invoices and the admin show it: the owner's own choice in
 * Website & banners → Shop name. Nothing else spells the name out.
 */
export const DEFAULT_STORE = 'Vandar Mart';

export const storeName = (s: Record<string, string | undefined>) => s.store_name?.trim() || DEFAULT_STORE;

/** The legal name on invoices and the footer (Settings → company name), or the shop name when none is set. */
export const companyName = (s: Record<string, string | undefined>) => s.company_name?.trim() || storeName(s);
