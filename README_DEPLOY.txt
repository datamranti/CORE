MRANTI CORE — BATCH 1 DEPLOYMENT

Repository deployment
1. Review and merge branch core-batch-1-foundation into main.
2. Keep GitHub Pages configured to publish the repository root from main.
3. Wait for the Pages workflow to complete, then hard-refresh the application.

n8n deployment
1. Back up the active workflow.
2. Import n8n/MRANTI CORE Batch 1.json.
3. Confirm the existing credentials are selected; do not create duplicates.
4. Activate the imported workflow and verify its production webhook URLs.

The functional n8n changes are limited to Format CRM Contacts Data and Build
Relationship Graph Page. Five additional nodes contain user-facing CORE/Context
wording only. The four Search Index generation/backfill nodes and all credential
assignments are preserved.

Post-deployment checks
- Sign in and restore a returning session.
- Load Calendar, then test manual Sync.
- Open Context, My Records, meeting submission, and business-card intake.
- Confirm Aina matches Aina but not Zainal; MIDA ranks direct organisation matches.
- Confirm email, phone, BM/English Search Index, graph filters, node interaction,
  and both Share actions.
- Check the browser console for new application errors.
