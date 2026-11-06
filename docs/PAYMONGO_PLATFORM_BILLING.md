# Don Mac POS — PayMongo platform subscription billing

## What gets charged
One PayMongo merchant account belongs only to the Don Mac POS platform owner (Admin Control).
Each franchise workspace pays its software subscription. Supply Chain / Main Office is a separate software tenant with its own subscription plan.
Franchise POS sales, supply purchasing and bank-proof verification remain entirely separate and unchanged.

## What is already deployed in the code
- Real subscription billing and payment history in franchise Account Settings and Supply Chain Subscription Billing.
- Admin Control billing dashboard, tenant plan management and paginated payment ledger.
- Server-side PayMongo v2 Hosted Checkout, invoice IDs, replay-safe signed webhook processing and automatic renewal after a verified payment.
- Unconfigured mode: Pay Now disabled and no charge made until merchant keys are installed.

Newly provisioned franchise workspaces automatically have the billing interface, but the platform administrator must assign plan, amount, and next payment date. Existing public self-registration remains disabled separately until multi-tenant isolation review; this integration does not enable signup.

## Activation checklist
1. Register and verify the platform owner's PayMongo merchant account. Activate QR Ph and any additional desired methods.
2. Configure the two Railway application services: DON-MAC-V2 and DON-MAC-SUPPLY-OFFICE. Add secret variables:
   PAYMONGO_SECRET_KEY=sk_test_... (or sk_live_... after testing)
   PAYMONGO_WEBHOOK_SECRET=<the secret of your test/live webhook>
   PAYMONGO_PAYMENT_METHODS=qrph (optional default; add gcash,paymaya,card only if enabled)
   Both app services currently require both secrets for readiness. Never commit the credentials to GitHub.
3. Create a PayMongo webhook endpoint using the PayMongo dashboard:
   https://don-mac-supply-office-production.up.railway.app/api/supply/office/billing/webhook
   Listen for checkout_session.payment.paid.
4. Restart or redeploy both Railway application services if required to load the secrets.
5. In Admin Control -> Account Directory, assign franchise subscription plans, amounts and next payment dates.
6. In Admin Control -> Billing & Payments, configure the Supply Chain tenant separately.
7. Test hosted checkout with PayMongo test keys and signed webhook events. Switch to live keys and a live webhook only after successful test reconciliation.

Optional return URLs (defaults are already set):
PAYMONGO_POS_RETURN_URL=https://donmacpos.com/?billing=return
PAYMONGO_OFFICE_RETURN_URL=https://don-mac-supply-office-production.up.railway.app/supply-office.html?billing=return

## Safety and lifecycle
- The tenant never sees secret keys and cannot set its own amount.
- Payments must match the invoice, checkout session, exact PHP centavo amount, payment status and PayMongo mode.
- Only signature-verified checkout_session.payment.paid notifications mark a subscription Paid and advance the due date one month.
- Duplicated webhook deliveries cannot renew an invoice more than once.
- Changing plan/amount while a checkout is pending can result in PAID_REVIEW, requiring manual resolution.
- Pending checkout sessions are reused to avoid double-charging. Reconcile or expire an outstanding PayMongo session before replacing it.
- This is tenant-initiated monthly renewal, not automatic recurring debit. No automatic account suspension is enabled.
- Existing developer demo subscriptions remain distinct from the real billing records.

Official reference:
https://docs.paymongo.com/docs/payment-channels-hosted-checkout
https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start
https://docs.paymongo.com/docs/developer-tools-webhook-setup-management
https://docs.paymongo.com/docs/developer-tools-webhooks-events
