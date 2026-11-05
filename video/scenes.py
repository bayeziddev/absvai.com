# The tutorial, scene by scene: what is on screen and what the narrator says, in standard (প্রমিত) Bangla.
#
# A line is either one string (shown as the caption and spoken as written) or a pair (caption, spoken) when the
# screen should show something the voice says differently, such as a web address. Button and menu names stay in
# English, exactly as the admin shows them, so viewers can find them; the voice says them in English.
#
# kind: title | chapter | shot | outro. A shot names a screenshot from capture.mjs, the part of it to zoom to (a box
# recorded by capture.mjs), the admin menu path, and whether a pointer clicks there.
import json, sys

S = []
def title(id, lines): S.append(dict(id=id, kind='title', lines=lines))
def chapter(id, num, text, sub, lines): S.append(dict(id=id, kind='chapter', num=num, text=text, sub=sub, lines=lines))
def shot(id, img, title, lines, focus=None, path=None, zoom=None, cursor=False, url=None):
    S.append(dict(id=id, kind='shot', img=img, title=title, lines=lines, focus=focus, path=path, zoom=zoom, cursor=cursor, url=url))
def outro(id, lines): S.append(dict(id=id, kind='outro', lines=lines))

title('intro', [
    'আসসালামু আলাইকুম। ভান্ডার মার্টের সম্পূর্ণ গাইডে আপনাকে স্বাগত জানাচ্ছি।',
    'এই ভিডিওতে আমরা দেখব, ক্রেতারা কীভাবে অর্ডার করেন, আর অ্যাডমিন ড্যাশবোর্ড থেকে কীভাবে পুরো দোকান পরিচালনা করবেন।',
])

chapter('ch1', '১', 'ক্রেতারা যা দেখেন', 'ওয়েবসাইট ও চেকআউট', ['প্রথমে দেখে নিই, ওয়েবসাইটে ক্রেতারা কী দেখতে পান।'])
shot('home', 'm-home', 'হোম পেজ', [
    'এটি ভান্ডার মার্টের হোম পেজ। ওপরে ব্যানার, তার নিচে ক্যাটাগরি আর পণ্যের তালিকা।',
    'মোবাইলে নিচের মেনু থেকে সহজেই কার্ট, উইশলিস্ট আর অ্যাকাউন্টে যাওয়া যায়।',
], focus='hero', url='vandarmart.com')
shot('home2', 'm-home-2', 'পণ্যের কার্ড', [
    'প্রতিটি পণ্যের নিচে দুটি বাটন আছে, Add to Cart আর Order Now।',
    'ওজন বা সাইজের অপশন থাকলে একটি ছোট ঘর খোলে, সেখান থেকে পছন্দমতো বেছে নেওয়া যায়।',
], focus='grid', url='vandarmart.com')
shot('product', 'm-product', 'পণ্যের পেজ', [
    'পণ্যের পেজে দাম, ছাড় আর বিভিন্ন অপশন থাকে। ওজন বেছে নিলে দাম নিজে থেকেই বদলে যায়।',
], focus='options', url='vandarmart.com/p/khejur-patali-gur')
shot('product-wa', 'm-product-2', 'WhatsApp-এ অর্ডার', [
    'সবুজ WhatsApp বাটনে চাপ দিলে পণ্যের নাম, পরিমাণ আর দামসহ একটি বাংলা মেসেজ তৈরি হয়ে সরাসরি আপনার WhatsApp-এ চলে যায়।',
], focus='wa', cursor=True, url='vandarmart.com/p/khejur-patali-gur')
shot('checkout1', 'm-checkout-1', 'বাংলায় চেকআউট', [
    'চেকআউট পুরোটাই বাংলায়। প্রথমে নাম আর মোবাইল নম্বর, তারপর পূর্ণ ঠিকানা লিখতে হয়।',
    'ক্রেতা বাংলা বা ইংরেজি, যেকোনো ভাষায় লিখতে পারেন।',
], focus='you', url='vandarmart.com/checkout')
shot('checkout2', 'm-checkout-2', 'ডেলিভারি চার্জ', [
    'ডেলিভারি চার্জ অংশে এলাকা বেছে নিতে হয়। রাজবাড়ীর ভিতরে সত্তর টাকা, আর রাজবাড়ীর বাইরে একশো ত্রিশ টাকা।',
    'এলাকা বেছে নিলেই মোট টাকার হিসাব নিজে থেকে হয়ে যায়।',
], focus='areas', url='vandarmart.com/checkout')
shot('checkout3', 'm-checkout-3', 'অর্ডার কনফার্ম', [
    'নিচে কুপন কোড দেওয়ার ঘর আর ‘অর্ডার কনফার্ম করুন’ বাটন রয়েছে।',
    'চাইলে WhatsApp বাটনে চাপ দিয়ে পুরো অর্ডারের তথ্য মেসেজ করেও পাঠানো যায়।',
], focus='place', cursor=True, url='vandarmart.com/checkout')
shot('done', 'm-done', 'অর্ডার সম্পন্ন', [
    'অর্ডার সম্পন্ন হলে অর্ডার নম্বরসহ একটি ধন্যবাদ পেজ আসে। এখান থেকেই ইনভয়েস ডাউনলোড করা যায়।',
], focus='invoice', cursor=True, url='vandarmart.com/order')
shot('invoice', 'm-invoice', 'ইনভয়েস', [
    'ইনভয়েসে দোকানের নাম, ক্রেতার ঠিকানা, পণ্যের তালিকা, ডেলিভারি চার্জ আর সর্বমোট টাকা থাকে।',
    'ডাউনলোড বাটনে চাপ দিয়ে এটি পিডিএফ হিসেবে সংরক্ষণ করা যায়।',
], url='vandarmart.com/order/invoice')
shot('account', 'm-account', 'ক্রেতার অ্যাকাউন্ট', [
    'ক্রেতা চাইলে নিজের অ্যাকাউন্ট খুলতে পারেন।',
    'পরের বার নাম, নম্বর আর ঠিকানা নিজে থেকেই বসে যায়, আর সব অর্ডার এক জায়গায় দেখা যায়।',
], url='vandarmart.com/account')
shot('track', 'm-track', 'অর্ডার ট্র্যাকিং', [
    'ট্র্যাকিং পেজে মোবাইল নম্বর বা অর্ডার নম্বর লিখলে জানা যায়, অর্ডারটি এখন কোন ধাপে আছে।',
], url='vandarmart.com/track')
shot('landing', 'm-landing', 'ল্যান্ডিং পেজ', [
    'বিজ্ঞাপনের জন্য আলাদা ল্যান্ডিং পেজ তৈরি করা যায়। এক পেজেই থাকে পণ্যের ছবি, বিবরণ আর অর্ডার ফর্ম।',
], url='vandarmart.com/lp/khejur-gur-offer')

chapter('ch2', '২', 'অ্যাডমিন ড্যাশবোর্ড', 'অর্ডার থেকে ডেলিভারি', ['এবার অ্যাডমিন ড্যাশবোর্ড। এখান থেকেই পুরো দোকান পরিচালনা করা হয়।'])
shot('login', 'a-login', 'অ্যাডমিনে লগইন', [
    ('ব্রাউজারে vandarmart.com/admin খুলুন। তারপর আপনার ইমেইল আর পাসওয়ার্ড দিয়ে Sign in করুন।',
     'ব্রাউজারে ভান্ডারমার্ট ডট কম স্ল্যাশ অ্যাডমিন খুলুন। তারপর আপনার ইমেইল আর পাসওয়ার্ড দিয়ে Sign in করুন।'),
], focus='form', path='vandarmart.com/admin', zoom=1.6, url='vandarmart.com/admin')
shot('dash', 'a-dashboard', 'ওভারভিউ', [
    'Overview পেজে এক নজরে সব দেখা যায়। কয়টি নতুন অর্ডার এসেছে, কয়টি কনফার্ম, প্যাক বা কুরিয়ারে আছে, আর আজকের বিক্রি কত।',
], focus='stages', path='Overview', url='vandarmart.com/admin/#/dashboard')
shot('dash2', 'a-dashboard-2', 'বিক্রির চার্ট', [
    'নিচে প্রতিদিনের বিক্রি আর অর্ডারের চার্ট। কতজন চেকআউট শুরু করেছেন আর কতজন অর্ডার শেষ করেছেন, সেটিও দেখা যায়।',
], focus='sales', path='Overview', url='vandarmart.com/admin/#/dashboard')
shot('dash3', 'a-dashboard-3', 'কোথা থেকে অর্ডার আসছে', [
    'এই মানচিত্রে দেখা যায়, কোন জেলা থেকে সবচেয়ে বেশি অর্ডার আসছে।',
], focus='map', path='Overview', url='vandarmart.com/admin/#/dashboard')
shot('orders', 'a-orders', 'অর্ডারের তালিকা', [
    'Orders পেজে সব অর্ডার ধাপ অনুযায়ী সাজানো থাকে, যেমন New, Confirmed, Packed, In Courier আর Delivered।',
    'ওপরের ঘরে মোবাইল নম্বর বা অর্ডার নম্বর লিখে যেকোনো অর্ডার খোঁজা যায়।',
], focus='tabs', path='Sales → Orders', url='vandarmart.com/admin/#/orders')
shot('order', 'a-order', 'অর্ডারের বিস্তারিত', [
    'কোনো অর্ডারে চাপ দিলে তার বিস্তারিত খুলে যায়। বাঁ পাশে পণ্য আর টাকার হিসাব, ডান পাশে ক্রেতার নাম, নম্বর ও ঠিকানা।',
], focus='items', path='Orders → একটি অর্ডারে চাপ দিন', url='vandarmart.com/admin/#/orders')
shot('wa1', 'a-order-wa', 'WhatsApp মেসেজ', [
    'অর্ডারের ভেতরে আছে সবুজ WhatsApp message বক্স। অর্ডারের সব তথ্য দিয়ে সুন্দর বাংলা মেসেজ আগে থেকেই লেখা থাকে।',
    'নতুন অর্ডারে ‘অর্ডার যাচাই’ মেসেজটি নিজে থেকেই বাছাই করা থাকে।',
], focus='text', path='Orders → অর্ডার → WhatsApp message', url='vandarmart.com/admin/#/orders')
shot('wa2', 'a-order-wa', 'Open WhatsApp', [
    'লেখাটি একবার পড়ে নিন, প্রয়োজনে বদলে নিন। তারপর Open WhatsApp বাটনে চাপ দিন।',
    'ক্রেতার চ্যাট খুলবে মেসেজ লেখা অবস্থায়, Send চাপলেই পৌঁছে যাবে।',
], focus='send', cursor=True, path='Open WhatsApp', url='vandarmart.com/admin/#/orders')
shot('wa3', 'a-order-wa', 'ক্রেতা ‘হ্যাঁ’ বললে', [
    'ক্রেতা ‘হ্যাঁ’ লিখে জানালে এই বাটনে চাপ দিন, তারপর অর্ডারটি কনফার্ম করুন।',
], focus='yes', cursor=True, path='The customer said “yes” on WhatsApp', url='vandarmart.com/admin/#/orders')
shot('move', 'a-order-move', 'অর্ডার কনফার্ম করা', [
    'Move order থেকে Confirmed বেছে নিয়ে Update stage চাপুন।',
    'এতে ইনভয়েস নম্বর তৈরি হয়, পণ্যের স্টক আলাদা করে রাখা হয়, আর ক্রেতা খবর পেয়ে যান।',
], focus='move', cursor=True, path='Move order → Update stage', url='vandarmart.com/admin/#/orders')
shot('edit1', 'a-edit', 'অর্ডার এডিট', [
    'ক্রেতা কিছু বদলাতে চাইলে Edit order চাপুন। নাম, নম্বর, ঠিকানা আর পণ্যের পরিমাণ, সবই বদলানো যায়।',
    'নিচের ঘরে নাম লিখে নতুন পণ্যও যোগ করা যায়।',
], focus='items', path='Orders → অর্ডার → Edit order', url='vandarmart.com/admin/#/orders')
shot('edit2', 'a-edit-2', 'ডেলিভারি চার্জ ও ফ্রি ডেলিভারি', [
    'ডেলিভারি এলাকা আর চার্জও বদলানো যায়। Free delivery-তে টিক দিলে চার্জ শূন্য হয়ে যায়।',
    'নিচে নতুন সর্বমোট দেখে Save changes চাপুন।',
], focus='money', path='Free delivery → Save changes', url='vandarmart.com/admin/#/orders')
shot('courier', 'a-courier-book', 'কুরিয়ারে পাঠানো', [
    'প্যাক হয়ে গেলে Steadfast বা Pathao বাটনে চাপ দিয়ে পার্সেল বুক করুন। ট্র্যাকিং আইডি নিজে থেকেই চলে আসে।',
], focus='book', cursor=True, path='Send with a courier', url='vandarmart.com/admin/#/orders')
shot('shipped', 'a-order-shipped-wa', '‘পাঠানো হয়েছে’ মেসেজ', [
    'কুরিয়ারে পাঠানোর পর ‘পাঠানো হয়েছে’ মেসেজে কুরিয়ারের নাম, ট্র্যাকিং আইডি আর ডেলিভারির সময় কত টাকা দিতে হবে, সবই থাকে।',
], focus='wa', path='WhatsApp message → পাঠানো হয়েছে', url='vandarmart.com/admin/#/orders')
shot('incomplete', 'a-incomplete', 'অসম্পূর্ণ অর্ডার', [
    'Incomplete orders-এ থাকে সেই ক্রেতাদের তথ্য, যাঁরা নম্বর লিখেও অর্ডার শেষ করেননি। কেউ WhatsApp-এ পাঠালে সেখানে সবুজ চিহ্ন থাকে।',
    'ফোন করে রাজি হলে Convert to order চাপুন।',
], focus='table', path='Sales → Incomplete orders', url='vandarmart.com/admin/#/incomplete')
shot('manual', 'a-manual', 'ফোন ও ফেসবুকের অর্ডার', [
    'ফেসবুক, মেসেঞ্জার বা ফোনে আসা অর্ডার New manual order থেকে লিখে নিন।',
    'মোবাইল নম্বর দিলেই ক্রেতার আগের অর্ডার আর ঠিকানা দেখা যায়।',
], focus='form', path='Sales → New manual order', url='vandarmart.com/admin/#/manual')
shot('returns', 'a-returns', 'ফেরত পার্সেল', [
    'ফেরত আসা পার্সেলের বারকোড এখানে স্ক্যান করলে স্টক আবার যোগ হয়ে যায়।',
], path='Sales → Returns scan', url='vandarmart.com/admin/#/returns')
shot('reports', 'a-reports', 'রিপোর্ট', [
    'Reports পেজে যেকোনো তারিখের বিক্রি, ডেলিভারি, ফেরত আর লাভের হিসাব দেখা যায়।',
], path='Sales → Reports', url='vandarmart.com/admin/#/reports')

chapter('ch3', '৩', 'পণ্য ও স্টক', 'যোগ করা, দাম ও স্টক', ['এবার পণ্য আর স্টক।'])
shot('products', 'a-products', 'পণ্যের তালিকা', [
    'Products পেজে সব পণ্যের তালিকা থাকে। নতুন পণ্য যোগ করতে Add product বাটনে চাপ দিন।',
], focus='table', path='Catalog → Products', url='vandarmart.com/admin/#/products')
shot('product-new', 'a-product-new', 'নতুন পণ্য যোগ', [
    'এক পেজেই সব কাজ। ছবি দিন, ক্যাটাগরি বেছে নিন, নাম আর দাম লিখুন, তারপর Save and publish চাপুন।',
], focus='form', path='Products → + Add product', url='vandarmart.com/admin/#/products')
shot('quick', 'a-quick-update', 'দাম ও স্টক একসাথে', [
    ('Update prices & stock পেজে এক টেবিলেই সব পণ্যের দাম আর স্টক বদলানো যায়।',
     'Update prices and stock পেজে এক টেবিলেই সব পণ্যের দাম আর স্টক বদলানো যায়।'),
], focus='table', path='Catalog → Update prices & stock', url='vandarmart.com/admin/#/quick-update')
shot('categories', 'a-categories', 'ক্যাটাগরি', [
    'Categories পেজে নতুন ক্যাটাগরি তৈরি করা আর সাজানো যায়।',
], path='Catalog → Categories', url='vandarmart.com/admin/#/categories')
shot('inventory', 'a-inventory', 'ইনভেন্টরি', [
    'Inventory পেজে প্রতিটি পণ্যের স্টক কত আছে, আর কতটি অর্ডারের জন্য আলাদা করে রাখা, সব দেখা যায়।',
], focus='table', path='Stock → Inventory', url='vandarmart.com/admin/#/inventory')

chapter('ch4', '৪', 'ডেলিভারি, মার্কেটিং ও সেটিংস', 'চার্জ, কুপন, ব্যানার', ['শেষ অংশে ডেলিভারি, মার্কেটিং আর সেটিংস।'])
shot('zones', 'a-settings-zones', 'ডেলিভারি চার্জ ঠিক করা', [
    'Settings-এ ডেলিভারি চার্জ ঠিক করুন, যেমন রাজবাড়ীর ভিতরে সত্তর টাকা। চাইলে নতুন এলাকাও যোগ করা যায়।',
], focus='zones', path='Settings → Delivery charges', url='vandarmart.com/admin/#/settings')
shot('couriers', 'a-couriers', 'কুরিয়ার যুক্ত করা', [
    'Couriers পেজে Steadfast আর Pathao-এর অ্যাকাউন্ট একবার যুক্ত করে নিন।',
], path='Delivery → Couriers', url='vandarmart.com/admin/#/courier')
shot('landing-admin', 'a-landing', 'ল্যান্ডিং পেজ তৈরি', [
    'Landing pages থেকে বিজ্ঞাপনের পেজ তৈরি করুন। পণ্য বেছে নিন, শিরোনাম আর ছবি দিন, তারপর প্রকাশ করুন।',
], path='Marketing → Landing pages', url='vandarmart.com/admin/#/landing')
shot('coupons', 'a-coupons', 'কুপন', [
    'Coupons পেজে ছাড়ের কোড তৈরি করুন: নির্দিষ্ট টাকা ছাড়, শতকরা ছাড়, অথবা ফ্রি ডেলিভারি।',
], path='Marketing → Coupons', url='vandarmart.com/admin/#/coupons')
shot('reviews', 'a-reviews', 'রিভিউ', [
    'ক্রেতাদের রিভিউ এখানে জমা হয়। অনুমোদন দিলে তবেই সেটি ওয়েবসাইটে দেখা যায়।',
], path='Marketing → Reviews', url='vandarmart.com/admin/#/reviews')
shot('website', 'a-website', 'ওয়েবসাইট ও ব্যানার', [
    ('Website & banners থেকে দোকানের নাম, লোগো আর হোম পেজের ব্যানার বদলানো যায়।',
     'Website and banners থেকে দোকানের নাম, লোগো আর হোম পেজের ব্যানার বদলানো যায়।'),
], path='Marketing → Website & banners', url='vandarmart.com/admin/#/website')
shot('emails', 'a-emails', 'ইমেইল', [
    'Emails পেজে ঠিক করে দিন, ক্রেতা আর আপনার কাছে কোন কোন ইমেইল যাবে।',
], path='Marketing → Emails', url='vandarmart.com/admin/#/emails')
shot('customers', 'a-customers', 'ক্রেতা', [
    'Customers পেজে সব ক্রেতার তালিকা, তাঁদের অর্ডার, ডেলিভারি আর ফেরতের হিসাব থাকে।',
], path='Marketing → Customers', url='vandarmart.com/admin/#/customers')
shot('settings', 'a-settings', 'সেটিংস', [
    'Settings-এ দোকানের ফোন নম্বর, WhatsApp নম্বর আর সোশ্যাল মিডিয়ার লিংক দিন।',
], path='Settings', url='vandarmart.com/admin/#/settings')
shot('help', 'a-help', 'হেল্প সেন্টার', [
    'কোনো কিছু বুঝতে সমস্যা হলে Help center-এ সম্পূর্ণ বাংলা গাইড আছে।',
], path='Settings → Help center', url='vandarmart.com/admin/#/help')
outro('outro', [
    'এই ছিল ভান্ডার মার্টের সম্পূর্ণ গাইড। ভিডিওটি দেখার জন্য আপনাকে আন্তরিক ধন্যবাদ।',
])

# Every line as {text (caption), say (spoken)}.
for s in S:
    s['lines'] = [{'text': l[0], 'say': l[1]} if isinstance(l, tuple) else {'text': l, 'say': l} for l in s['lines']]

def markdown():
    out = ['# Vandar Mart ভিডিও গাইড: পুরো স্ক্রিপ্ট', '', 'ভিডিওতে যা বলা হবে, দৃশ্য অনুযায়ী। কোনো শব্দ বদলাতে চাইলে video/scenes.py-তে সেই লাইনটি বদলান।', '']
    for s in S:
        head = {'title': 'শুরু', 'chapter': f"অংশ {s.get('num')}: {s.get('text')}", 'outro': 'শেষ'}.get(s['kind']) or s['title']
        out.append(f"## {head}" + (f"  \n`{s['path']}`" if s.get('path') else ''))
        out += [f"- {l['text']}" + (f"  \n  (বলা হবে: {l['say']})" if l['say'] != l['text'] else '') for l in s['lines']] + ['']
    return '\n'.join(out)

if __name__ == '__main__':
    if sys.argv[1].endswith('.md'):
        open(sys.argv[1], 'w', encoding='utf-8').write(markdown())
    else:
        json.dump(S, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(S), 'scenes', sum(len(s['lines']) for s in S), 'lines')
