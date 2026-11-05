# TODO

## বাংলা quick-order form
- [x] Website এবং landing page checkout-এ নাম, মোবাইল নম্বর ও সম্পূর্ণ ঠিকানা ছাড়া কোনো Division/District/Area/Union dropdown, postcode বা auto-location থাকবে না।
- [x] Delivery charge-এর জন্য শুধু রাজবাড়ীর ভিতরে ৳৭০ এবং রাজবাড়ীর বাইরে/সারা বাংলাদেশ ৳১৩০-এর দুইটি option থাকবে।
- [x] Product summary, COD reassurance, total এবং দ্রুত order button কম box-এর mobile-first design-এ থাকবে।

## Shared backend flow
- [x] Website ও landing page একই নতুন `deliveryChoice` payload ব্যবহার করবে।
- [x] Existing checkout session, fraud, incomplete-order capture, coupon/payment ও admin order pipeline বজায় থাকবে।
- [x] Backend selected delivery option অনুযায়ী fixed zone/charge হিসাব করবে এবং পুরোনো geo payload compatibility রাখবে।

## Validation
- [x] Typecheck এবং relevant tests pass করতে হবে।
- [x] Git diff review করে পরিবর্তিত ফাইলগুলো পরিষ্কার রাখতে হবে।
