fgos-live snapshot @ 2026-10-08T08-14-18-644Z

Captured before the live push of a70eb69 (FGOS Bridge plugin + staging infra).

## Firestore — FULL EXPORT
gs://ai-studio-bucket-876707527934-europe-west2/fgos-backups/fgos-live-2026-10-08T08-14-18-644Z

Exported with `gcloud firestore export` (all_namespaces / all_kinds, including
overall_export_metadata). This is the complete Firestore state at the moment of
capture: brands, content_items, blog_register, blog_counters, activity_logs.

## WordPress — REST snapshot (danielstastypetfoods.co.uk)
- wp/posts.json     (336,724 b)  published posts
- wp/pages.json     (477,763 b)  pages
- wp/products.json  (232,128 b)  WooCommerce store products
- wp/fgos-register.json          FGOS blog register snapshot

## Notes
- The local server dump endpoint (/api/admin/firestore-dump) returns count -1 on
  this machine because it has no Firestore credentials. The GCS export above is
  the authoritative capture; the JSON dump is a convenience path only.
- Restore: `gcloud firestore import gs://.../all_namespaces` (see git log for the
  exact path) or import the WP JSON to restore content.