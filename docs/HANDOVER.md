# Handover: give the shop owner their own admin password

Use this when you hand the live shop to the owner. It makes the owner's password one only they know, retires the old
one, and (optionally) keeps a developer support account for you. Nothing here touches the storefront or the orders.

## How the admin password works

- The admin has no "forgot password" screen by design. The **first** account is made once, at `/admin/`, by whoever
  has the one-time **`SETUP_TOKEN`**. That screen only appears while the store has **no** admin account.
- After that, more staff are added from **Staff & roles** inside the admin.
- A session is tied to a live, active account: delete or disable a staff member and they are signed out on their next
  click, not twelve hours later.

## Give the owner a fresh password (at handover)

Do these in order. Steps 1–2 are yours (developer); step 4 is the owner's.

1. **Rotate the setup token.** Make a new value — never reuse the old one, and don't paste it into a chat:
   ```bash
   openssl rand -hex 24
   ```
   GitHub → the repository → **Settings → Secrets and variables → Actions** → open **`SETUP_TOKEN`** → **Update** →
   paste the new value → save.
2. **Re-deploy** so the Worker picks up the new token: **Actions → Test and deploy → Run workflow** on `main` (or push
   any commit). Wait for it to finish green.
3. **Clear the current admin** so the first-run screen comes back. Either ask your agent to delete it, or run:
   ```bash
   npx wrangler d1 execute DB --remote -c worker/wrangler.toml --command "DELETE FROM admins"
   ```
   The old password stops working immediately, and the admin now shows the setup screen.
4. **Owner creates their account.** Hand the owner the new token privately. They open `/admin/`, enter the token, and
   set **their own** name, email and password (at least 10 characters, with a letter and a number). From now the token
   does nothing (it only works while there is no admin), so it cannot be used again.

That is the whole reset. The owner's password is theirs alone; you never see it.

## Optional: a developer support account that survives a reset

If you support the shop after handover, keep a standing Super Admin for yourself that is restored on every deploy, so a
future password reset or database restore never locks you out. **Tell the owner this account exists** — it is listed in
**Staff & roles** like any other, and the owner can remove it at any time (below). It is support access, not a hidden
door.

1. Add two repository secrets (same place as above): **`DEV_ADMIN_EMAIL`** (your email) and **`DEV_ADMIN_PASSWORD`**
   (your own strong password — choose it yourself; it is never shown anywhere and never needs to be typed into a chat).
   Optionally `DEV_ADMIN_NAME` for the display name.
2. Re-deploy **after the owner has created their account** (step 4 above). The deploy adds your account beside theirs.
   On every later deploy it refreshes your account's password to match the secret and restores it to full access, so
   it is always available for support.
3. The password rule is the same as the admin's: at least 10 characters, a letter and a number.

The password is stored only in the GitHub secret and, hashed with PBKDF2, in the database — never in the code, the
deploy logs, or the admin screens.

**The owner stays in control.** To end the developer's standing access: delete the `DEV_ADMIN_EMAIL` /
`DEV_ADMIN_PASSWORD` secrets (so it is no longer restored), then delete or disable the account in **Staff & roles**.

## বাংলায় (দোকান মালিকের জন্য)

হ্যান্ডওভারের দিন ডেভেলপার একটি নতুন **setup token** তৈরি করে দেবেন। আপনি `/admin/` খুলে সেই token দিয়ে **নিজের** নাম,
ইমেইল আর পাসওয়ার্ড দিয়ে অ্যাকাউন্ট তৈরি করবেন (অন্তত ১০ অক্ষর, তাতে অক্ষর আর একটি সংখ্যা থাকতে হবে)। এই পাসওয়ার্ড শুধু
আপনিই জানবেন — ডেভেলপারও জানবেন না। একবার অ্যাকাউন্ট তৈরি হলে পুরোনো পাসওয়ার্ড আর setup token দুটোই অকেজো হয়ে যায়।

ডেভেলপারের জন্য একটি আলাদা সাপোর্ট অ্যাকাউন্ট থাকতে পারে, যাতে দরকারে তিনি সাহায্য করতে পারেন। সেটি **Staff & roles**-এ
সবার মতোই দেখা যায়, লুকানো কিছু নয়। না চাইলে আপনি সেটি **Staff & roles** থেকে মুছে বা বন্ধ করে দিতে পারেন।
