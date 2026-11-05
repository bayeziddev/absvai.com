# Quick order checkout redesign

## Requirements
- Website checkout এবং landing-page checkout একই বাংলা quick-order form ব্যবহার করবে।
- শুধু নাম, মোবাইল নম্বর ও সম্পূর্ণ ঠিকানা থাকবে; Division/District/Area/Union dropdown, postcode এবং auto-location থাকবে না।
- Delivery option দুইটি থাকবে: রাজবাড়ীর ভিতরে ৳৭০ এবং রাজবাড়ীর বাইরে/সারা বাংলাদেশ ৳১৩০।
- Product summary, COD reassurance, delivery choice এবং total ছোট কম-বক্সের mobile-first layout-এ থাকবে।
- Existing checkout session, fraud checks, incomplete-order capture, coupon/payment support এবং admin order pipeline বজায় থাকবে।

## Implementation
- `CheckoutForm` থেকে geo finder/select/map বাদ দিয়ে বাংলা নাম/মোবাইল/address fields এবং দুইটি delivery radio option রাখা হবে।
- `checkout.js` থেকে geo loading, postcode, GPS, map ও dependent select logic বাদ দিয়ে `deliveryChoice`-ভিত্তিক quote/place payload করা হবে।
- Quote service-এ নতুন fixed delivery choice path যোগ হবে; পুরোনো district/upazila path compatibility হিসেবে থাকবে।
- Place-order service-এ নতুন quick-order address-এর জন্য geo validation bypass করে safe display names ও selected fixed delivery zone সংরক্ষণ হবে; পুরোনো geo payload আগের মতো validate হবে।
- Existing delivery-zone seed values (৳৭০/৳১৩০) ব্যবহার করা হবে, নতুন data platform যোগ করা হবে না।

## Project structure
- `worker/src/views/pages.tsx`: shared checkout form markup.
- `worker/src/views/landing.tsx`: landing page shared form consumer.
- `public/js/checkout.js`: quote, capture and submit browser flow.
- `worker/src/services/checkout.ts`: delivery quote calculation.
- `worker/src/services/orders.ts`: order validation and placement.
- `worker/src/repo/geo.ts`: fixed delivery-zone lookup.
- `public/css/app.css`: quick-order card styling.
