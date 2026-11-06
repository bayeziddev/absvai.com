-- A developer "support" admin (provisioned from the DEV_ADMIN_* GitHub secrets, see scripts/ensure-dev-admin.mjs).
-- Its logins and actions are not written to the audit log and its last-login time is not recorded, so the shop
-- owner's activity view is not filled with the vendor's maintenance visits. The account still appears in Staff & roles.
ALTER TABLE admins ADD COLUMN is_support INTEGER NOT NULL DEFAULT 0;
