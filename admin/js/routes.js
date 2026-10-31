import { dashboard } from './views/dashboard.js';
import { orders } from './views/orders.js';
import { incomplete, manual, returns } from './views/sales.js';
import { products } from './views/products.js';
import { attributes, categories, labels, synonyms, templates } from './views/catalog.js';
import { audit, customers, inventory, outbox, preorders, seasons, wholesale } from './views/ops.js';
import { zones } from './views/geo.js';
import { security } from './views/security.js';
import { help, settings, soon, staff } from './views/settings.js';
import { website } from './views/website.js';
import { emails } from './views/emails.js';
import { courier } from './views/courier.js';
import { sellers } from './views/sellers.js';
import { landing } from './views/landing.js';
import { coupons } from './views/coupons.js';
import { reviews } from './views/reviews.js';
import { reports } from './views/reports.js';

// `simple: true` items are the everyday screens shown in simple mode (the default); "Show all tools" reveals the rest.
// Postcodes, cities and courier areas work by themselves (imported data, picked per order), so they have no screens;
// delivery charges are edited in Settings, which links to the zone details (#/zones) for the rare district change.
export const NAV = [
  { route: 'dashboard', simple: true, label: 'Overview', icon: 'dash' },
  { group: 'Sales' },
  { route: 'orders', simple: true, label: 'Orders', icon: 'orders' },
  { route: 'incomplete', simple: true, label: 'Incomplete orders', icon: 'clock' },
  { route: 'manual', simple: true, label: 'New manual order', icon: 'plus' },
  { route: 'returns', simple: true, label: 'Returns scan', icon: 'scan' },
  { route: 'reports', simple: true, label: 'Reports', icon: 'chart' },
  { route: 'preorders', label: 'Pre-orders & Notify-me', icon: 'clock' },
  { group: 'Catalog' },
  { route: 'products', simple: true, label: 'Products', icon: 'box' },
  { route: 'categories', simple: true, label: 'Categories', icon: 'layers' },
  { route: 'templates', label: 'Product templates', icon: 'file' },
  { route: 'attributes', label: 'Attribute types', icon: 'tag' },
  { route: 'labels', label: 'Barcodes & labels', icon: 'barcode' },
  { group: 'Stock' },
  { route: 'inventory', simple: true, label: 'Inventory', icon: 'box' },
  { group: 'Delivery' },
  { route: 'courier', simple: true, label: 'Couriers', icon: 'truck' },
  { group: 'Marketing' },
  { route: 'landing', simple: true, label: 'Landing pages', icon: 'file' },
  { route: 'coupons', simple: true, label: 'Coupons', icon: 'tag' },
  { route: 'reviews', simple: true, label: 'Reviews', icon: 'chat' },
  { route: 'website', simple: true, label: 'Website & banners', icon: 'image' },
  { route: 'emails', simple: true, label: 'Emails', icon: 'mail' },
  { route: 'customers', simple: true, label: 'Customers', icon: 'users' },
  { route: 'sellers', simple: true, label: 'Sellers', icon: 'users' },
  { route: 'seasons', simple: true, label: 'Seasons', icon: 'sun' },
  { route: 'wholesale', label: 'Wholesale inquiries', icon: 'users' },
  { route: 'synonyms', label: 'Search synonyms', icon: 'search' },
  { group: 'Team' },
  { route: 'staff', label: 'Staff & roles', icon: 'shield' },
  { group: 'Security' },
  { route: 'security', label: 'Block list & attempts', icon: 'lock' },
  { route: 'audit', label: 'Audit log', icon: 'file' },
  { group: 'Settings' },
  { route: 'settings', simple: true, label: 'Settings', icon: 'gear' },
  { route: 'outbox', label: 'SMS outbox', icon: 'chat' },
  { route: 'help', simple: true, label: 'Help center', icon: 'help' },
];

export const routes = {
  dashboard, orders, incomplete, manual, returns, preorders, customers, wholesale, products, categories, templates, attributes, labels,
  inventory, seasons, synonyms, zones, settings, staff, security, outbox, audit, help, soon, website, emails, courier, sellers, landing, coupons, reviews, reports,
};
