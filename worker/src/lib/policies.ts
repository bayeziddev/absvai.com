/** The shop's policy pages (/policies/:slug); the shop assistant quotes them too. */
export const POLICIES: Record<string, { title: string; body: string[] }> = {
  delivery: { title: 'Delivery & payment', body: [
    'We deliver to all 64 districts of Bangladesh. The delivery charge depends on your area and the packed weight of your parcel, and is shown at checkout before you order.',
    'Cash on Delivery is available everywhere. Pre-orders, large items and some high-value orders need an advance (usually the delivery charge) by bKash, Nagad or Rocket. The amount is always shown before you pay, and it is deducted from your total.',
    'We confirm every Cash on Delivery order by an SMS code or a short phone call before we ship it.',
  ] },
  returns: { title: 'Returns & refunds', body: [
    'Please check your parcel in front of the delivery person. If something is wrong, damaged or not what you ordered, you can return it on the spot.',
    'Food items cannot be returned once opened, except when they are spoiled or damaged on arrival. Tell us within 24 hours with a photo.',
    'Refunds for advances and returns are sent to the wallet you paid from, usually within 3 working days. (Final policy to be confirmed by ABS VAI LTD.)',
  ] },
  privacy: { title: 'Privacy', body: [
    'We use your phone number, name and address only to deliver your order, confirm it and tell you about it. We do not sell your details.',
    'If you tap “Use my location” at checkout, your browser’s location is used on your phone to pick your district and is never sent to or stored by us.',
    'Checkout details are saved as you type so our team can help you if an order does not go through. Unfinished checkouts are deleted after 60 days, and you can ask us to delete them sooner.',
    'To stop fraud and fake orders we keep a random device ID in a cookie and a scrambled (hashed) form of your connection’s IP address. These are one signal among several and are never used for advertising.',
    'We count visits and pages viewed with our own first-party analytics. Ad pixels (Meta, Google) only load when the store enables them, and never fire for pages you did not open.',
  ] },
  credits: { title: 'Credits & data sources', body: [
    'Divisions, districts, upazilas, unions, district coordinates and outlines: Bangladesh-geocode by Sayad Md Bayezid Hosan (MIT licence).',
    'Postcodes: the postcode-bd list in Bangladesh-geocode, compiled from Wikipedia’s “List of postal codes in Bangladesh” (CC BY-SA 4.0).',
    'Product photos are the shop’s own or supplied with permission by its suppliers.',
  ] },
};
