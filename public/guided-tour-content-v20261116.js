/* Don Mac POS contextual tour content. Never request or mutate business data. */
(() => {
  'use strict';
  const item = (title, body, target, tab) => ({ title, body, target, tab });
  const G = {
    dashboard: {
      label: 'Dashboard', intro: 'Learn how to read sales, stock alerts and operating trends. Numbers are scoped to your accessible branches and reporting period.',
      steps: [
        item('Dashboard overview', 'The dashboard is your performance summary. Always check the selected branch and reporting period before comparing revenue, orders, expenses, discounts and low stock.', '#view-dashboard #dashboardSummary'),
        item('Performance cards', 'The cards summarize important metrics. Gross represents sales before adjustments; net or actual figures reflect the applicable deductions. Review the card labels before sharing figures.', '#dashboardSummary'),
        item('Sales trends', 'Use the trend controls to compare activity by time and spot busy hours. Cashiers may see a shorter history than managers, based on their granted reporting window.', '#salesTrendChart'),
        item('Recent activity', 'Recent transactions help verify that a sale was posted. Refresh or open the Transactions section for an individual order’s detailed record.', '#dashboardRecentTransactions'),
        item('Stock warnings', 'Low-stock alerts are a signal to inspect the actual ingredient quantity in Inventory. Resolve shortages before accepting orders you cannot fulfill.', '#dashboardLowStock')
      ]
    },
    pos: {
      label: 'Point of Sale', intro: 'A safe walkthrough of the cashier checkout flow. The guide never places a real order, collects payment or changes stock.',
      steps: [
        item('Find the menu', 'Choose a menu category, search for a product by name, and check which items are available. Disabled or out-of-stock products should not be sold.', '#categoryTabs'),
        item('Search products', 'Type part of a product name to filter the menu. Clear the search when switching categories so you do not accidentally hide a product.', '#searchBox'),
        item('Choose a product', 'Product cards open the item options or add the item to the current order. Check size, add-ons, quantities and available stock before proceeding.', '#catalogGrid'),
        item('Choose order type', 'Select Dine In, Take Away or Order Online as appropriate. This is recorded on the transaction and can change the location details required.', '.order-type-switch'),
        item('Customer and location', 'Enter customer name and table/location details when useful. Verify names carefully; optional fields do not replace payment or stock validation.', '#posCustomerName'),
        item('Review current order', 'Check the item list, quantities, prices, included add-ons and discounts. Clear removes the working order, so do not clear while serving a customer.', '.order-panel'),
        item('Checkout and payment', 'Before finalizing, confirm the total and select the actual payment method. Enter exact cash tender or the correct reference for non-cash payments. A successful checkout records the sale and deducts ingredient stock.', '#checkoutButton'),
        item('Receipt and reconciliation', 'After payment succeeds, review the receipt and transaction reference. Use Transactions to locate the entry if a customer asks about a previous purchase.', '.order-panel')
      ]
    },
    inventory: {
      label: 'Inventory', intro: 'Understand stock on hand, replenishment, incoming requests, inter-branch transfer and the audit trail. This tour does not save movements.',
      steps: [
        item('Branch stock view', 'Stock is tracked within the appropriate franchise and branch. Owners may choose the branch to inspect; cashiers work within their assigned branch.', '#view-inventory'),
        item('Stock monitoring', 'Use search, grouping, sorting and status filters to find an ingredient. Compare On Hand with the reorder level; low or critical stock needs attention.', '#inventoryStatusFilter'),
        item('Receiving and opening stock', 'For a new branch, an Owner/Co-Owner sets initial stock. Do not use opening-stock entry for repeated deliveries. Cashiers with Inventory permission can perform normal replenishment.', '#replenishEntryType', 'replenish'),
        item('Replenish', 'Choose the correct receiving branch, select the ingredients and quantities, and record supplier/deliverer information before saving. A direct supplier replenishment differs from an inter-branch transfer.', '#replenishForm', 'replenish'),
        item('Incoming supply', 'For requests requiring acceptance, inspect source branch, requesting user, expected deliverer and quantities. Accept only what was actually received; reject incorrect requests with the appropriate workflow.', '#incomingSupplyPanel'),
        item('Transfer between branches', 'Transfer is for eligible Business accounts with another active branch. Check the From and To branches, item quantities and receiving party. Approval or receipt confirms a real physical movement; the tour never submits one.', '#inventoryTransferTab'),
        item('Transfer details', 'When the transfer screen is available, review the origin, destination and receiver before any stock move. Check the available quantity at the sending branch.', '#transferForm'),
        item('Audit history', 'Open the movement audit to trace who created, sent, accepted or rejected stock changes. Expand a row to inspect the ingredients within that movement.', '#view-inventory .inv-audit-card')
      ]
    },
    chat: {
      label: 'Messages', intro: 'Communicate with teammates using only conversations permitted for your account.',
      steps: [
        item('Communication channels', 'Select the correct owner, coworker or branch group conversation. Only the chats available to your account should be visible.', '#view-chat'),
        item('Compose carefully', 'Type a clear request, include relevant branch/order context, and verify the recipient before sending.', '#chatDraft'),
        item('Photos and attachments', 'Attach an image only if needed for business coordination. Avoid sharing customer payment credentials or sensitive personal information.', '#chatFloatingPanel'),
        item('Follow-up', 'Return to the conversation to see replies. Messages are not a substitute for the inventory acceptance or transaction posting workflow.', '#view-chat')
      ]
    },
    transactions: {
      label: 'Transactions', intro: 'Find and inspect completed orders and payment records without changing an underlying sale.',
      steps: [
        item('Transaction ledger', 'Transactions list the orders in the period and branch you are allowed to see. A cashier’s historical range may be limited by the assigned permissions.', '#view-transactions'),
        item('Filters', 'Use date, branch, cashier, status or payment filters when available. Clear filters to restore the full permitted view.', '.dm-transaction-filters'),
        item('Transaction details', 'Open a row to review its items, payment method, discounts and reference. Use recorded details for reconciliation; do not assume every draft order was paid.', '#financeTransactionsBody')
      ]
    },
    expenses: {
      label: 'Expenses', intro: 'Track operating costs with the correct branch and date. Editing depends on your permission level.',
      steps: [
        item('Daily expense ledger', 'Review the date, branch and expense categories before entering or searching records. Expenses affect financial reconciliation.', '#view-expenses'),
        item('Record by category', 'Use the relevant rent, salary, transport, utility, inventory or miscellaneous field. Enter only verified amounts and a useful note.', '#financeExpenseForm'),
        item('Filter and total', 'Apply date and branch filters to reconcile daily totals. Cashiers granted view-only permission may inspect records but cannot manage them.', '#financeExpenseApply'),
        item('Avoid duplicates', 'Before saving or editing, check whether the expense already exists. The guide is read-only and will never submit or edit an expense.', '#financeExpensesBody')
      ]
    },
    reports: {
      label: 'Sales Report', intro: 'Read detailed sales, product performance, discounts and ingredient usage over your allowed date range.',
      steps: [
        item('Period and scope', 'Select the report period and branch, if available to you. A cashier can only access the assigned branch and the time span the owner granted.', '#reportPeriod'),
        item('Revenue breakdown', 'Compare gross, adjusted, actual and net values using the table headings. Returns, discounts and other adjustments can change net results.', '#view-reports'),
        item('Product summary', 'Use product quantities and revenue to identify top-selling and slow-moving menu items. Report figures are based on recorded transactions.', '#reportProducts'),
        item('Promotions and ingredient cost', 'Inspect promo purchases and ingredient usage/costing to understand what sold and how much stock was consumed.', '#reportPromos'),
        item('Transaction audit', 'Use reference and payment details to verify individual sales. Download/export only when authorized for the report and date range.', '#reportTransactions')
      ]
    },
    advanced: {
      label: 'Advanced Report / Inventory Management', intro: 'Understand Pro versus Business features and the advanced analytics available for eligible subscriptions.',
      steps: [
        item('Plan comparison', 'Pro contains core sales and inventory tools. Business adds inter-branch transfer and the dedicated advanced analytics workspace.', '#advancedPlanComparison'),
        item('Business analytics', 'When your plan allows, open the financial, branch, menu, customer, cashier and operations views. Locked previews are not live records.', '#advancedReferenceSection'),
        item('Branch comparisons', 'Check selected branches and dates carefully. Avoid comparing figures from different time windows or mixing gross with net revenue.', '#advancedReferenceContent'),
        item('Restricted features', 'If a feature is locked by your plan, request an authorized upgrade through Account Settings. The guide cannot grant access.', '#advancedReferenceLock')
      ]
    },
    supply: {
      label: 'Supply Chain', intro: 'Order ingredients and follow procurement approvals without submitting a sample order.',
      steps: [
        item('Browse supply catalog', 'Search the main-office price list and check the unit of measure before selecting quantities. Pricing may change with promotions.', '#supplyProductsList'),
        item('Request details', 'Select the destination branch and standard or urgent priority. Review fee, royalty and subtotal breakdowns before requesting supplies.', '#supplyRequestForm'),
        item('Proof of payment', 'Upload a valid confirmation image when required and verify the payment reference. Main Office still reviews the payment before approval.', '#supplyPaymentPhoto'),
        item('Track fulfillment', 'Watch the request status and delivery timeline. On-hold, denied and approved statuses require different next actions.', '#supplyOrdersBody'),
        item('Contact Main Office', 'Use the request’s messages to ask for clarification and retain a traceable conversation about a delivery.', '#supplyMessageForm')
      ]
    },
    catalog: {
      label: 'POS Catalog', intro: 'Set up the menu and costing in a sensible order: ingredients, categories, products, recipes, promotions and backups.',
      steps: [
        item('Catalog sections', 'The category tiles switch between independent catalog editors. No changes are saved by viewing or switching tabs.', '#adminTabs'),
        item('Products', 'Add the name, category, sale price and availability for a menu item; confirm it is assigned to the intended franchise.', '#admin-productSearch', 'products'),
        item('POS Categories', 'Maintain the menu categories and icons shown at checkout. Inactive categories should not be offered to cashiers.', '#admin-categories', 'categories'),
        item('Ingredients', 'Maintain ingredient names and units before assigning recipe requirements. Stock levels belong to Inventory.', '#admin-ingredients', 'ingredients'),
        item('Recipes and costing', 'Link ingredient quantities to products and review calculated costs. Correct recipe quantities are essential for stock deduction.', '#admin-recipes', 'recipes'),
        item('Promotions', 'Set eligible items, limits, prices and status carefully so checkout reflects the intended offer.', '#admin-promos', 'promos'),
        item('Packages', 'When offered in your version, review included products and quantities before activating a bundle.', '#admin-packages', 'packages'),
        item('Backups', 'Review supported archive and backup actions before using them. Verify a successful download and safeguard files appropriately.', '#admin-backups', 'backups')
      ]
    },
    'catalog:products': {
      label: 'Catalog • Products', parent: 'catalog', tab: 'products', intro: 'Create, edit and check the menu items that cashiers can sell.',
      steps: [
        item('Product directory', 'Search products first to prevent duplicates. Open an existing product to update it rather than creating another entry.', '#adminProductsBody'),
        item('Product editor', 'Enter a clear product name, correct category, selling price and photo if applicable. Check active status before saving.', '#productForm'),
        item('Cost and recipe', 'After creating the product, configure its recipe in Recipes & Costing. An unconfigured recipe may not deduct the intended ingredients.', '#productForm')
      ]
    },
    'catalog:categories': {
      label: 'Catalog • POS Categories', parent: 'catalog', tab: 'categories', intro: 'Control what category buttons cashiers see.',
      steps: [
        item('Category tiles', 'Use descriptive names and recognizable icons for Coffee, Non Coffee, Food, Add-ons and other enabled sections.', '#admin-categories'),
        item('Display status', 'Verify whether a category is Active/Visible in POS before saving. Hide categories that are not ready to sell.', '#posCategoryActive')
      ]
    },
    'catalog:ingredients': {
      label: 'Catalog • Ingredients', parent: 'catalog', tab: 'ingredients', intro: 'Create the ingredient definitions used in stock and recipe costing.',
      steps: [
        item('Ingredient list', 'Check existing names and unit measures before adding an ingredient. Duplicate names can cause mismatched recipe usage.', '#admin-ingredients'),
        item('Recipe readiness', 'Use a consistent unit of measure, then assign ingredient quantities in Recipes & Costing and replenish branch stock in Inventory.', '#admin-ingredients')
      ]
    },
    'catalog:recipes': {
      label: 'Catalog • Recipes & Costing', parent: 'catalog', tab: 'recipes', intro: 'Ensure each sold product deducts the correct quantity of every ingredient.',
      steps: [
        item('Choose product', 'Select the correct menu product before editing its ingredient formula.', '#recipeProduct'),
        item('Recipe ingredients', 'Enter required ingredient quantities in compatible units. Review total unit cost and margin before saving.', '#recipeBody'),
        item('Verify after saving', 'Test checkout on an authorized test transaction and inspect stock deduction. Avoid altering live stock just to test the guide.', '#saveRecipe')
      ]
    },
    'catalog:promos': {
      label: 'Catalog • Promos', parent: 'catalog', tab: 'promos', intro: 'Set up discounted offers with clear eligibility rules.',
      steps: [
        item('Promotion details', 'Enter the name, included items, price and limits. Check all restrictions before the promotion is active.', '#promoForm'),
        item('Review on POS', 'Use the POS preview/authorized checkout process to verify the intended price and inclusion. The guide will not activate a promotion.', '#adminPromosBody')
      ]
    },
    'catalog:packages': {
      label: 'Catalog • Packages', parent: 'catalog', tab: 'packages', intro: 'Manage bundles if packages are enabled for the account.',
      steps: [
        item('Package details', 'Enter a package name, selling price and active status.', '#packageForm'),
        item('Included products', 'Choose the intended components and quantities. Avoid including inactive items.', '#compositionBatchArea')
      ]
    },
    'catalog:backups': {
      label: 'Catalog • Backups', parent: 'catalog', tab: 'backups', intro: 'Learn safe backup and historical export practices.',
      steps: [
        item('Before export', 'Confirm the right account and date range. An export is a snapshot and does not replace managed database backups.', '#admin-backups'),
        item('Verify files', 'Store downloaded archives securely and verify their contents before relying on them for a restore.', '#admin-backups')
      ]
    },
    users: {
      label: 'Branches & Cashiers', intro: 'Owners and co-owners administer branches, employees and individual feature permissions.',
      steps: [
        item('Choose management page', 'Use the Branches and Cashiers tabs to switch between locations and staff accounts.', '#usersTabBranches'),
        item('Branch directory', 'Check active branches, user assignments and plan limits before adding or deactivating a location.', '#usersBranchesPage'),
        item('Cashier accounts', 'Create a unique account, assign its branch and choose Cashier or Co-Owner appropriately. A staff member’s role changes their allowed actions.', '#usersCashiersPage', 'cashiers'),
        item('Cashier permissions', 'Grant only the specific Dashboard, Inventory, Messages, Sales Report, Transactions and Expenses capabilities needed for the job.', '#cashierAccessControls', 'cashiers'),
        item('Reporting window', 'For cashier reports, select the permitted 1-day, 1-week or 1-month history. This is access control, not just a visual filter.', '#cashierReportWindow', 'cashiers')
      ]
    },
    'users:branches': {
      label: 'Branches • Management', parent: 'users', tab: 'branches', intro: 'Set up locations and the accounts assigned to them.',
      steps: [
        item('Branch list', 'Check existing branches before adding a new one. The active status can affect POS operations.', '#branchesBody'),
        item('Plan allowance', 'Review how many branches are included in the subscription before adding another. Deactivated branches may require staff reassignment.', '#branchAllowanceNotice'),
        item('Branch details', 'Enter location information carefully and save only after validating contacts and branch name.', '#branchForm')
      ]
    },
    'users:cashiers': {
      label: 'Cashiers • Access control', parent: 'users', tab: 'cashiers', intro: 'Set up staff accounts and the least-privilege permission list.',
      steps: [
        item('Account identity', 'Enter a unique username, name and optional email address. Without a working email address, automated password recovery may be unavailable.', '#newUsername'),
        item('Role and branch', 'Cashiers take orders in their assigned branch. Co-Owners manage the franchise and do not access cashier checkout.', '#newRole'),
        item('Access checkboxes', 'Choose exactly which features the cashier may access. Stock replenishment and transfer also remain subject to plan and branch rules.', '#cashierAccessControls'),
        item('Report history', 'Limit the cashier’s report history to the intended 1-day, 1-week or 1-month window.', '#cashierReportWindow'),
        item('Save and test', 'After saving a staff account, sign in with that account on a separate session and confirm only the approved pages and data are visible.', '#usersCashiersPage')
      ]
    },
    logs: {
      label: 'System Logs', intro: 'Review traceable account and operational activity when troubleshooting or auditing.',
      steps: [
        item('Audit records', 'Use the log filters to narrow events by time, user or action when available. Logs are a record of actions, not a replacement for current stock or financial balances.', '#view-logs'),
        item('Investigate carefully', 'Confirm the affected branch, account and event timestamp before drawing conclusions from a log entry.', '#view-logs')
      ]
    },
    account: {
      label: 'Account Settings', intro: 'Learn subscription status, permitted features, billing and plan-change requirements.',
      steps: [
        item('Subscription status', 'Review current plan, payment status, renewal date and remaining days. These values can determine checkout and branch allowances.', '#accountPaymentStatus'),
        item('Plan change requests', 'Check Pro or Business features and additional branch charges before requesting a plan update.', '#accountPlanSelect'),
        item('Downgrades', 'Reducing a plan may require selecting branches to remain active. Staff assigned to a deactivated branch may need reassignment.', '#accountDowngradeBranches'),
        item('Billing', 'Use the displayed payment status and verified payment channel. A submitted payment request is not necessarily an approved subscription.', '#tenantBilling')
      ]
    }
  };
  window.donmacGuideLibrary = Object.freeze(G);
})();
