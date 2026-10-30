/**
 * Launch configuration for Abs Vai (build prompt Section 3.2). Turned into SQL by scripts/gen-seed.ts.
 * After launch, all of this is edited in admin: templates are data, not code.
 */

export interface AttributeTypeDef {
  id: string;
  name: string;
  input?: 'chips' | 'swatch' | 'select';
  helpText?: string;
  values?: Array<string | { value: string; hex: string }>;
}

export interface SpecFieldDef {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'number' | 'date' | 'select' | 'dimensions' | 'file' | 'boolean';
  unit?: string;
  required?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: string[];
  panel?: 'details' | 'specs' | 'in_box' | 'warranty' | 'care' | 'food';
  showOnProductPage?: boolean;
  canBecomeVariant?: boolean;
  filterable?: boolean;
  cardFormat?: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  explanation: string;
  variantAttributes: Array<{ attributeTypeId: string; label?: string; required: boolean; presetValues: string[]; allowCustomValues?: boolean }>;
  specFields: SpecFieldDef[];
  defaultShippingProfile: 'standard' | 'fragile' | 'heavy_bulky' | 'perishable';
  allowedFulfilment: Array<'in_stock' | 'pre_order' | 'made_to_order'>;
  requiresSizeChart?: boolean;
  sizeChartColumns?: string[];
  requiresBrand?: boolean;
  requiresNetQuantity?: boolean;
  cardKeySpecs: string[];
}

export const ATTRIBUTE_TYPES: AttributeTypeDef[] = [
  { id: 'weight', name: 'Weight', helpText: 'How much the customer gets, e.g. 500g or 1kg.', values: ['250g', '500g', '1kg', '2kg', '5kg'] },
  { id: 'pack_size', name: 'Pack size', values: ['50g', '100g', '250g', '500g', '1kg'] },
  { id: 'packaging', name: 'Packaging', values: ['Foil tray', 'Clay pot (hari)', 'Jar'] },
  { id: 'model_size', name: 'Size / model', helpText: 'e.g. 4-inch press, 300mm sealer.', values: ['4-inch', '6-inch', '200mm', '300mm', '400mm'] },
  { id: 'power_type', name: 'Power type', values: ['Manual', 'Electric'] },
  { id: 'tool_size', name: 'Size', values: ['8×6 inch', '10×8 inch'] },
  { id: 'finish', name: 'Finish', values: ['Natural', 'Colored'] },
  { id: 'home_size', name: 'Size', values: ['Small', 'Standard', 'Large'] },
  { id: 'apparel_size', name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  {
    id: 'color', name: 'Color', input: 'swatch',
    values: [
      { value: 'Black', hex: '#1F1F1F' }, { value: 'White', hex: '#FFFFFF' }, { value: 'Red', hex: '#B3261E' },
      { value: 'Maroon', hex: '#6D1B1B' }, { value: 'Navy', hex: '#1E2A4A' }, { value: 'Blue', hex: '#2D5DA8' },
      { value: 'Green', hex: '#2E7D32' }, { value: 'Olive', hex: '#6B6B2A' }, { value: 'Brown', hex: '#6B4226' },
      { value: 'Beige', hex: '#D9C7A3' }, { value: 'Grey', hex: '#8A8A8A' }, { value: 'Pink', hex: '#D98BA0' },
    ],
  },
  { id: 'shoe_size', name: 'Shoe size', helpText: 'BD/EU sizes.', values: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  { id: 'storage_model', name: 'Storage / model', values: [] },
  { id: 'supply_size', name: 'Size', values: [] },
  { id: 'pack_qty', name: 'Pack quantity', values: ['50 pcs', '100 pcs', '500 pcs'] },
  { id: 'grade', name: 'Grade', values: ['Premium', 'Grade A', 'Grade B'] },
];

const bestBefore: SpecFieldDef = { key: 'best_before', label: 'Best-before date', type: 'date', required: true, panel: 'food', helpText: 'Required for food products.' };
const warrantyPeriod: SpecFieldDef = { key: 'warranty_period', label: 'Warranty period', type: 'text', required: true, panel: 'warranty', placeholder: '1 year', helpText: 'Write "No warranty" if there is none.', cardFormat: '{value} warranty' };
const warrantyBy: SpecFieldDef = { key: 'warranty_by', label: 'Who honours the warranty', type: 'select', required: true, panel: 'warranty', options: ['Brand', 'Abs Vai', 'None'] };
const inTheBox: SpecFieldDef = { key: 'in_the_box', label: "What's in the box", type: 'longtext', required: true, panel: 'in_box', placeholder: 'Machine, 5 dies, user manual' };

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'weighed_food',
    name: 'Weighed food',
    explanation: 'Food products need weight options, where it comes from, a batch and a best-before date.',
    variantAttributes: [
      { attributeTypeId: 'weight', required: true, presetValues: ['250g', '500g', '1kg', '2kg', '5kg'] },
      { attributeTypeId: 'packaging', required: false, presetValues: ['Foil tray', 'Clay pot (hari)', 'Jar'] },
    ],
    specFields: [
      { key: 'origin', label: 'Origin / source area', type: 'text', required: true, panel: 'food', placeholder: 'Jashore', helpText: 'Where it was made or harvested.', filterable: true },
      { key: 'batch_no', label: 'Batch no. or production / harvest date', type: 'text', required: true, panel: 'food', placeholder: 'Batch 12 · Dec 2026' },
      bestBefore,
      { key: 'ingredients', label: 'Ingredients', type: 'longtext', required: true, panel: 'food', placeholder: '100% date-palm sap' },
      { key: 'storage', label: 'Storage instructions', type: 'longtext', required: true, panel: 'food', placeholder: 'Keep in a cool, dry place. Refrigerate after opening.' },
      { key: 'season_window', label: 'Season window', type: 'text', panel: 'food', placeholder: 'December – February' },
      { key: 'taste_notes', label: 'Taste notes', type: 'longtext', panel: 'details' },
      { key: 'heat_sensitive', label: 'Heat sensitive in transit', type: 'boolean', panel: 'food', showOnProductPage: false, helpText: 'Tick if it can melt or spoil in a hot van.' },
    ],
    defaultShippingProfile: 'perishable',
    allowedFulfilment: ['in_stock', 'pre_order'],
    requiresNetQuantity: true,
    cardKeySpecs: ['net_weight', 'origin'],
  },
  {
    id: 'packaged_food',
    name: 'Packaged food & spices',
    explanation: 'Packaged food needs pack sizes, the full ingredients list, a best-before date and the packer’s details.',
    variantAttributes: [{ attributeTypeId: 'pack_size', required: true, presetValues: ['50g', '100g', '250g', '500g', '1kg'] }],
    specFields: [
      { key: 'ingredients', label: 'Full ingredients list', type: 'longtext', required: true, panel: 'food' },
      bestBefore,
      { key: 'manufacturer', label: 'Manufacturer / packer name & address', type: 'longtext', required: true, panel: 'food', placeholder: 'ABS VAI LTD, …' },
      { key: 'licence_no', label: 'BSTI / licence no.', type: 'text', panel: 'food', helpText: 'Where applicable. Check with BSTI before launch.' },
      { key: 'usage', label: 'Usage directions', type: 'longtext', required: true, panel: 'details' },
      { key: 'used_for', label: 'Used for (dishes)', type: 'text', panel: 'details', placeholder: 'fuchka, chotpoti, jhal muri, haleem', helpText: 'Comma separated. Links to recipes later.' },
      { key: 'spice_level', label: 'Spice level', type: 'select', options: ['Mild', 'Medium', 'Hot'], panel: 'details', filterable: true },
    ],
    defaultShippingProfile: 'standard',
    allowedFulfilment: ['in_stock'],
    requiresNetQuantity: true,
    cardKeySpecs: ['net_weight', 'spice_level'],
  },
  {
    id: 'machinery',
    name: 'Machinery',
    explanation: 'Machines need a size or model choice, capacity, what’s in the box and the warranty.',
    variantAttributes: [
      { attributeTypeId: 'model_size', required: true, presetValues: ['4-inch', '6-inch', '200mm', '300mm', '400mm'] },
      { attributeTypeId: 'power_type', required: false, presetValues: ['Manual', 'Electric'] },
    ],
    specFields: [
      { key: 'model_no', label: 'Model no.', type: 'text', required: true, panel: 'specs', placeholder: 'PFS-300' },
      { key: 'body_material', label: 'Body material', type: 'text', required: true, panel: 'specs', placeholder: 'Cast iron, food-grade steel cylinder' },
      { key: 'capacity', label: 'Capacity / output', type: 'text', required: true, panel: 'specs', placeholder: '5 kg per hour' },
      inTheBox,
      warrantyPeriod,
      warrantyBy,
      { key: 'power_watts', label: 'Power', type: 'number', unit: 'W', panel: 'specs' },
      { key: 'voltage', label: 'Voltage', type: 'text', panel: 'specs', placeholder: '220V AC' },
      { key: 'manual_pdf', label: 'User manual (PDF)', type: 'file', panel: 'specs' },
      { key: 'business_guide', label: 'Linked business guide (URL)', type: 'text', panel: 'details' },
      { key: 'spare_parts', label: 'Spare parts', type: 'longtext', panel: 'specs' },
    ],
    defaultShippingProfile: 'heavy_bulky',
    allowedFulfilment: ['in_stock', 'made_to_order'],
    cardKeySpecs: ['variant.model_size', 'warranty_period'],
  },
  {
    id: 'handmade_tool',
    name: 'Handmade tool',
    explanation: 'Handmade wooden tools need a size, the wood type, dimensions and care instructions.',
    variantAttributes: [
      { attributeTypeId: 'tool_size', required: true, presetValues: ['8×6 inch', '10×8 inch'] },
      { attributeTypeId: 'finish', required: false, presetValues: ['Natural', 'Colored'] },
    ],
    specFields: [
      { key: 'wood_type', label: 'Wood type', type: 'text', required: true, panel: 'specs', placeholder: 'Mahogany', canBecomeVariant: true, filterable: true },
      { key: 'finish_detail', label: 'Finish', type: 'text', required: true, panel: 'specs', placeholder: 'Food-safe polish' },
      { key: 'dimensions', label: 'Dimensions', type: 'dimensions', unit: 'inch', required: true, panel: 'specs' },
      { key: 'care', label: 'Care instructions', type: 'longtext', required: true, panel: 'care', placeholder: 'Wipe dry after use. Do not soak.' },
      { key: 'bonus_item', label: 'Free bonus item', type: 'text', panel: 'details', placeholder: 'Rolling pin', helpText: 'Shows as a "Free bonus" benefit chip.' },
      { key: 'lead_time_days', label: 'Lead time if made to order', type: 'number', unit: 'days', panel: 'details' },
    ],
    defaultShippingProfile: 'standard',
    allowedFulfilment: ['in_stock', 'made_to_order'],
    cardKeySpecs: ['variant.tool_size', 'wood_type'],
  },
  {
    id: 'bulky_home',
    name: 'Bulky home item',
    explanation: 'Furniture needs full dimensions, material, assembly details and item weight for delivery.',
    variantAttributes: [
      { attributeTypeId: 'finish', required: false, presetValues: ['Natural', 'Colored'] },
      { attributeTypeId: 'home_size', required: false, presetValues: ['Small', 'Standard', 'Large'] },
    ],
    specFields: [
      { key: 'dimensions', label: 'Dimensions (H × W × D)', type: 'dimensions', unit: 'inch', required: true, panel: 'specs' },
      { key: 'material', label: 'Material / wood type', type: 'text', required: true, panel: 'specs', placeholder: 'Teak', canBecomeVariant: true, filterable: true },
      { key: 'assembly_required', label: 'Assembly required', type: 'boolean', required: true, panel: 'specs' },
      { key: 'assembly_guide', label: 'Assembly guide (PDF)', type: 'file', panel: 'specs' },
      { key: 'max_load', label: 'Max load', type: 'number', unit: 'kg', required: true, panel: 'specs' },
      { key: 'item_weight', label: 'Item weight', type: 'number', unit: 'kg', required: true, panel: 'specs' },
      { key: 'delivery_note', label: 'Delivery note', type: 'text', panel: 'details', placeholder: 'Delivered assembled inside Dhaka' },
    ],
    defaultShippingProfile: 'heavy_bulky',
    allowedFulfilment: ['in_stock', 'made_to_order'],
    cardKeySpecs: ['dimensions', 'material'],
  },
  {
    id: 'apparel',
    name: 'Clothing',
    explanation: 'Clothing needs size and color options, fabric, care instructions and a size chart.',
    variantAttributes: [
      { attributeTypeId: 'apparel_size', required: true, presetValues: ['S', 'M', 'L', 'XL', 'XXL'] },
      { attributeTypeId: 'color', required: true, presetValues: [] },
    ],
    specFields: [
      { key: 'fabric', label: 'Fabric', type: 'text', required: true, panel: 'specs', placeholder: '100% cotton', filterable: true },
      { key: 'care', label: 'Care instructions', type: 'longtext', required: true, panel: 'care' },
      { key: 'gender_age', label: 'For', type: 'select', required: true, options: ['Men', 'Women', 'Boys', 'Girls', 'Unisex', 'Kids'], panel: 'specs', filterable: true },
      { key: 'fit', label: 'Fit', type: 'select', options: ['Regular', 'Slim', 'Loose'], panel: 'specs' },
      { key: 'occasion', label: 'Occasion', type: 'text', panel: 'details', placeholder: 'Eid, winter' },
    ],
    defaultShippingProfile: 'standard',
    allowedFulfilment: ['in_stock'],
    requiresSizeChart: true,
    sizeChartColumns: ['Chest (inch)', 'Length (inch)', 'Shoulder (inch)'],
    cardKeySpecs: ['fabric'],
  },
  {
    id: 'footwear',
    name: 'Shoes',
    explanation: 'Shoes need sizes, a size chart with foot length in cm, and upper and sole materials.',
    variantAttributes: [
      { attributeTypeId: 'shoe_size', required: true, presetValues: ['39', '40', '41', '42', '43', '44'] },
      { attributeTypeId: 'color', required: false, presetValues: [] },
    ],
    specFields: [
      { key: 'upper_material', label: 'Upper material', type: 'text', required: true, panel: 'specs', placeholder: 'Genuine leather', filterable: true },
      { key: 'sole_material', label: 'Sole material', type: 'text', required: true, panel: 'specs', placeholder: 'Rubber' },
      { key: 'occasion', label: 'Occasion', type: 'text', panel: 'details' },
    ],
    defaultShippingProfile: 'standard',
    allowedFulfilment: ['in_stock'],
    requiresSizeChart: true,
    sizeChartColumns: ['Foot length (cm)'],
    cardKeySpecs: ['upper_material'],
  },
  {
    id: 'electronics',
    name: 'Electronics',
    explanation: 'Gadgets need a color, brand and model, what’s in the box and warranty details.',
    variantAttributes: [
      { attributeTypeId: 'color', required: true, presetValues: [] },
      { attributeTypeId: 'storage_model', required: false, presetValues: [] },
    ],
    specFields: [
      { key: 'model_no', label: 'Model no.', type: 'text', required: true, panel: 'specs' },
      warrantyPeriod,
      warrantyBy,
      inTheBox,
      { key: 'power_spec', label: 'Power / battery', type: 'text', required: true, panel: 'specs', placeholder: '300mAh, USB-C charging' },
      { key: 'compatibility', label: 'Compatibility notes', type: 'longtext', panel: 'specs' },
    ],
    defaultShippingProfile: 'fragile',
    allowedFulfilment: ['in_stock'],
    requiresBrand: true,
    cardKeySpecs: ['warranty_period'],
  },
  {
    id: 'simple',
    name: 'Simple product',
    explanation: 'Simple products can have a color option or none at all.',
    variantAttributes: [{ attributeTypeId: 'color', required: false, presetValues: [] }],
    specFields: [
      { key: 'material', label: 'Material', type: 'text', required: true, panel: 'specs' },
      { key: 'dimensions', label: 'Dimensions', type: 'dimensions', unit: 'cm', required: true, panel: 'specs' },
    ],
    defaultShippingProfile: 'standard',
    allowedFulfilment: ['in_stock'],
    cardKeySpecs: ['material'],
  },
  {
    id: 'pack_supply',
    name: 'Packaging supply',
    explanation: 'Packaging supplies need a size, a pack quantity, material and whether they are food-safe.',
    variantAttributes: [
      { attributeTypeId: 'supply_size', required: true, presetValues: [] },
      { attributeTypeId: 'pack_qty', required: true, presetValues: ['50 pcs', '100 pcs', '500 pcs'] },
    ],
    specFields: [
      { key: 'material', label: 'Material', type: 'text', required: true, panel: 'specs', placeholder: 'Kraft paper' },
      { key: 'dimensions', label: 'Dimensions', type: 'dimensions', unit: 'cm', required: true, panel: 'specs' },
      { key: 'food_safe', label: 'Food-safe', type: 'boolean', required: true, panel: 'specs', filterable: true },
    ],
    defaultShippingProfile: 'standard',
    allowedFulfilment: ['in_stock'],
    requiresNetQuantity: true,
    cardKeySpecs: ['variant.pack_qty', 'material'],
  },
];

export interface CategoryDef {
  slug: string;
  name: string;
  code: string;
  template: string;
  icon: string;
  parent?: string;
  seasons?: string[]; // season slugs; when set the category only shows during those seasons
  description?: string;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: 'organic-seasonal-food', name: 'Organic & Seasonal Food', code: 'ORG', template: 'weighed_food', icon: '/img/placeholders/mango.svg', description: 'Gur, honey, ghee, dates, aromatic rice and pitha flour from the regions they are known for.' },
  { slug: 'khejur-gur', name: 'Khejur Gur', code: 'ORG', template: 'weighed_food', icon: '/img/placeholders/gur.svg', parent: 'organic-seasonal-food', seasons: ['winter'], description: 'Date-palm jaggery: patali, liquid (jhola) and nolen gur.' },
  { slug: 'spices-masala', name: 'Spices & Masala', code: 'SPC', template: 'packaged_food', icon: '/img/placeholders/masala.svg', description: 'Abs Vai Master Masala and single spices.' },
  { slug: 'food-business-machines', name: 'Food Business Machines', code: 'MCH', template: 'machinery', icon: '/img/placeholders/press.svg', description: 'Presses, sealers and juicers for small food businesses.' },
  { slug: 'presses', name: 'Presses', code: 'MCH', template: 'machinery', icon: '/img/placeholders/press.svg', parent: 'food-business-machines' },
  { slug: 'sealers', name: 'Sealers', code: 'MCH', template: 'machinery', icon: '/img/placeholders/sealer.svg', parent: 'food-business-machines' },
  { slug: 'kitchen-wooden-tools', name: 'Kitchen & Wooden Tools', code: 'TLS', template: 'handmade_tool', icon: '/img/placeholders/velpuri.svg', description: 'Handmade velpuri makers, mashers and rolling boards.' },
  { slug: 'home-furniture', name: 'Home & Furniture', code: 'HOM', template: 'bulky_home', icon: '/img/placeholders/rack.svg' },
  { slug: 'clothing', name: 'Clothing', code: 'CLO', template: 'apparel', icon: '/img/placeholders/panjabi.svg' },
  { slug: 'winter-wear', name: 'Winter Wear', code: 'CLO', template: 'apparel', icon: '/img/placeholders/shawl.svg', parent: 'clothing', seasons: ['winter'] },
  { slug: 'shoes', name: 'Shoes', code: 'SHO', template: 'footwear', icon: '/img/placeholders/loafer.svg' },
  { slug: 'gadgets-electronics', name: 'Gadgets & Electronics', code: 'GAD', template: 'electronics', icon: '/img/placeholders/watch.svg' },
  { slug: 'accessories', name: 'Accessories', code: 'ACC', template: 'simple', icon: '/img/placeholders/wallet.svg' },
  { slug: 'packaging-supplies', name: 'Packaging Supplies', code: 'PKG', template: 'pack_supply', icon: '/img/placeholders/pouch.svg', description: 'Food boxes, pouches and zip bags for small businesses.' },
];

/** Seasons are created without dates: Ramadan and Eid move every year, so the owner sets exact dates in admin. */
export const SEASONS: Array<{ slug: string; name: string; accentLabel: string; accentColor: string; backInSeason: string; intro: string }> = [
  { slug: 'winter', name: 'Winter', accentLabel: 'Winter special', accentColor: '#2D5DA8', backInSeason: 'November', intro: 'Khejur gur, winter wear and pitha essentials.' },
  { slug: 'ramadan-iftar', name: 'Ramadan & Iftar', accentLabel: 'Iftar ready', accentColor: '#2E7D32', backInSeason: 'Ramadan', intro: 'Masala, fuchka and chotpoti machines and tools for iftar.' },
  { slug: 'eid-ul-fitr', name: 'Eid-ul-Fitr', accentLabel: 'Eid collection', accentColor: '#6D1B1B', backInSeason: 'Eid-ul-Fitr', intro: 'Panjabi, kurti and gifts for Eid.' },
  { slug: 'eid-ul-adha', name: 'Eid-ul-Adha', accentLabel: 'Qurbani prep', accentColor: '#6B4226', backInSeason: 'Eid-ul-Adha', intro: 'Masala and kitchen tools for Eid-ul-Adha.' },
  { slug: 'mango', name: 'Mango season', accentLabel: 'Fresh mango', accentColor: '#F2B705', backInSeason: 'May', intro: 'Mangoes direct from Rajshahi and Chapainawabganj.' },
  { slug: 'puja', name: 'Puja', accentLabel: 'Puja special', accentColor: '#B3261E', backInSeason: 'Puja', intro: 'Festive food and clothing.' },
  { slug: 'back-to-school', name: 'Back-to-school', accentLabel: 'School ready', accentColor: '#1E2A4A', backInSeason: 'January', intro: 'Bags, shoes and tiffin boxes.' },
];

/** Placeholder charges: confirm with the client (build prompt, "Confirm with the client" #3). */
export const ZONES = [
  { name: 'Inside Dhaka City', base: 7000, baseWeight: 1000, extraPerKg: 1500, bulky: 40000, eta: '1–2 days', isDefault: false,
    upazilas: ['Dhaka North City Corporation', 'Dhaka South City Corporation'] },
  { name: 'Dhaka Suburbs', base: 10000, baseWeight: 1000, extraPerKg: 2000, bulky: 60000, eta: '2–3 days', isDefault: false,
    districts: ['Dhaka', 'Gazipur', 'Narayanganj'] },
  { name: 'Outside Dhaka', base: 13000, baseWeight: 1000, extraPerKg: 2500, bulky: 80000, eta: '3–5 days', isDefault: true },
];

export const SYNONYM_GROUPS: Record<string, string[]> = {
  gur: ['patali gur', 'patali', 'khejur gur', 'khejurer gur', 'nolen gur', 'notun gur', 'date palm jaggery', 'jaggery', 'gur', 'jhola gur'],
  fuchka: ['fuchka', 'phuchka', 'puchka', 'panipuri', 'pani puri', 'golgappa', 'gol gappa'],
  chotpoti: ['chotpoti', 'chatpati', 'chotpotti'],
  chanachur: ['chanachur', 'chanachur machine', 'chanachur maker', 'chanachur press', 'chanachur making machine'],
  jhalmuri: ['jhal muri', 'jhalmuri', 'jhal mudi'],
  velpuri: ['velpuri', 'bhelpuri', 'bhel puri', 'belpuri', 'velpuri maker'],
  sealer: ['sealer', 'impulse sealer', 'hand sealer', 'packet sealer', 'sealing machine', 'poly sealer'],
  masala: ['masala', 'moshla', 'mosla', 'spice', 'spices', 'master masala'],
  haleem: ['haleem', 'halim'],
  panjabi: ['panjabi', 'punjabi', 'jubba', 'kurta'],
};

export const SETTINGS: Record<string, string> = {
  store_name: 'Abs Vai',
  tagline: 'Seasonal goods, honest prices.',
  announcement: 'Cash on Delivery all over Bangladesh · Free delivery over ৳1,500',
  free_delivery_threshold_paisa: '150000',
  free_delivery_excludes_bulky: '1',
  cod_fee_paisa: '0',
  advance_high_value_threshold_paisa: '500000',
  support_phone: '',
  whatsapp_number: '',
  messenger_page: '',
  manual_wallets: '[]',
  map_tile_url: '',
  map_tile_attribution: '',
  ai_chat_enabled: '0',
  company_name: 'ABS VAI LTD',
  company_address: '',
  pixel_id: '',
  ga4_id: '',
  catalog_version: '1',
  geo_postcode_version: '1',
};
