import { dashboard } from './views/dashboard.js';
import { orders } from './views/orders.js';
import { incomplete, manual, returns } from './views/sales.js';
import { products } from './views/products.js';
import { attributes, categories, labels, synonyms, templates } from './views/catalog.js';
import { audit, customers, inventory, outbox, preorders, seasons, wholesale } from './views/ops.js';
import { couriers, geo, zones } from './views/geo.js';
import { security } from './views/security.js';
import { help, settings, soon, staff } from './views/settings.js';

export const NAV = [
  { route: 'dashboard', label: 'Overview', icon: 'dash' },
  { group: 'Sales' },
  { route: 'orders', label: 'Orders', icon: 'orders' },
  { route: 'incomplete', label: 'Incomplete orders', icon: 'clock' },
  { route: 'manual', label: 'New manual order', icon: 'plus' },
  { route: 'returns', label: 'Returns scan', icon: 'scan' },
  { route: 'preorders', label: 'Pre-orders & Notify-me', icon: 'clock' },
  { group: 'Catalog' },
  { route: 'products', label: 'Products', icon: 'box' },
  { route: 'categories', label: 'Categories', icon: 'layers' },
  { route: 'templates', label: 'Product templates', icon: 'file' },
  { route: 'attributes', label: 'Attribute types', icon: 'tag' },
  { route: 'labels', label: 'Barcodes & labels', icon: 'barcode' },
  { group: 'Stock' },
  { route: 'inventory', label: 'Inventory', icon: 'box' },
  { group: 'Delivery' },
  { route: 'zones', label: 'Delivery zones', icon: 'truck' },
  { route: 'geo', label: 'Postcodes & geo', icon: 'pin' },
  { route: 'couriers', label: 'Courier area mapping', icon: 'truck' },
  { group: 'Marketing' },
  { route: 'customers', label: 'Customers', icon: 'users' },
  { route: 'seasons', label: 'Seasons', icon: 'sun' },
  { route: 'wholesale', label: 'Wholesale inquiries', icon: 'users' },
  { route: 'synonyms', label: 'Search synonyms', icon: 'search' },
  { label: 'Landing pages', icon: 'file', soon: 'Phase 2' },
  { label: 'Coupons', icon: 'tag', soon: 'Phase 2' },
  { label: 'Reviews', icon: 'chat', soon: 'Phase 2' },
  { group: 'Team' },
  { route: 'staff', label: 'Staff & roles', icon: 'shield' },
  { label: 'Reports', icon: 'chart', soon: 'Phase 3' },
  { group: 'Security' },
  { route: 'security', label: 'Block list & attempts', icon: 'lock' },
  { route: 'audit', label: 'Audit log', icon: 'file' },
  { group: 'Settings' },
  { route: 'settings', label: 'Settings', icon: 'gear' },
  { route: 'outbox', label: 'SMS outbox', icon: 'chat' },
  { route: 'help', label: 'Help center', icon: 'help' },
];

export const routes = {
  dashboard, orders, incomplete, manual, returns, preorders, customers, wholesale, products, categories, templates, attributes, labels,
  inventory, seasons, synonyms, zones, geo, couriers, settings, staff, security, outbox, audit, help, soon,
};
