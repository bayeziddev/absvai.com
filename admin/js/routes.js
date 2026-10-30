import { dashboard } from './views/dashboard.js';
import { orders } from './views/orders.js';
import { products } from './views/products.js';
import { attributes, categories, synonyms, templates } from './views/catalog.js';
import { abandoned, audit, customers, inventory, outbox, preorders, seasons, wholesale } from './views/ops.js';
import { couriers, geo, zones } from './views/geo.js';
import { help, settings, soon, staff } from './views/settings.js';

export const NAV = [
  { route: 'dashboard', label: 'Dashboard', icon: 'dash' },
  { group: 'Sell' },
  { route: 'orders', label: 'Orders', icon: 'orders' },
  { route: 'preorders', label: 'Pre-orders & Notify-me', icon: 'clock' },
  { route: 'abandoned', label: 'Abandoned checkouts', icon: 'orders' },
  { route: 'customers', label: 'Customers', icon: 'users' },
  { route: 'wholesale', label: 'Wholesale Inquiries', icon: 'users' },
  { group: 'Catalog' },
  { route: 'products', label: 'Products', icon: 'box' },
  { route: 'categories', label: 'Categories', icon: 'layers' },
  { route: 'templates', label: 'Product Templates', icon: 'file' },
  { route: 'attributes', label: 'Attribute Types', icon: 'tag' },
  { route: 'inventory', label: 'Inventory', icon: 'box' },
  { route: 'seasons', label: 'Seasons', icon: 'sun' },
  { route: 'synonyms', label: 'Search synonyms', icon: 'search' },
  { label: 'Landing Pages', icon: 'file', soon: 'Phase 2' },
  { label: 'Coupons', icon: 'tag', soon: 'Phase 2' },
  { label: 'Reviews', icon: 'chat', soon: 'Phase 2' },
  { label: 'Recipes & Guides', icon: 'file', soon: 'Phase 3' },
  { group: 'Delivery' },
  { route: 'zones', label: 'Delivery Zones', icon: 'truck' },
  { route: 'geo', label: 'Postcodes & Geo', icon: 'pin' },
  { route: 'couriers', label: 'Courier Area Mapping', icon: 'truck' },
  { group: 'Store' },
  { route: 'settings', label: 'Settings', icon: 'gear' },
  { route: 'staff', label: 'Staff & Roles', icon: 'shield' },
  { route: 'outbox', label: 'SMS outbox', icon: 'chat' },
  { route: 'audit', label: 'Audit log', icon: 'file' },
  { label: 'Chat Settings', icon: 'chat', soon: 'Phase 3' },
  { label: 'Reports', icon: 'chart', soon: 'Phase 3' },
  { route: 'help', label: 'Help Center', icon: 'help' },
];

export const routes = { dashboard, orders, preorders, abandoned, customers, wholesale, products, categories, templates, attributes, inventory, seasons, synonyms, zones, geo, couriers, settings, staff, outbox, audit, help, soon };
