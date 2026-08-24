#!/bin/bash
# Quick test: push a minimal article to DTP and check if <style> survived.
# Usage: ./test-snippet.sh "https://danielstastypetfoods.co.uk" "admin_dtp" "xxxx xxxx xxxx xxxx"
#
# Then open the returned URL and view-source to check for <style> tags.

WP_URL="${1:?Usage: ./test-snippet.sh <wp_url> <username> <app_password>}"
WP_USER="${2:?Usage: ./test-snippet.sh <wp_url> <username> <app_password>}"
WP_PASS="${3:?Usage: ./test-snippet.sh <wp_url> <username> <app_password>}"

TEST_TITLE="Style Preserver Test ($(date +%H%M%S))"
TEST_SLUG="style-test-$(date +%s)"

TEST_HTML='<div class="fg-art" style="max-width:800px;margin:0 auto;font-family:Roboto,sans-serif;color:#2D3748;">
<style>.fg-art h2{color:#203B32;font-family:Jost,sans-serif;border-bottom:3px solid #C9A24A;padding-bottom:8px;}</style>
<h2 style="color:#203B32;font-family:Jost,sans-serif;">Test Heading — DTP Green</h2>
<p style="font-family:Roboto,sans-serif;color:#2D3748;">This is a test paragraph styled with inline styles and a scoped style block. If the snippet is working, this heading will be dark green (#203B32) with a gold underline, and the paragraph will use Roboto.</p>
<p style="font-size:0.85em;color:#718096;">— FGOS Style Test</p>
</div>'

echo "Publishing test article to $WP_URL..."

RESPONSE=$(curl -s -u "$WP_USER:$WP_PASS" \
  -X POST "$WP_URL/wp-json/wp/v2/posts" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg title "$TEST_TITLE" \
    --arg slug "$TEST_SLUG" \
    --arg content "$TEST_HTML" \
    '{title: $title, slug: $slug, content: $content, status: "publish"}')")

POST_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
POST_URL=$(echo "$RESPONSE" | jq -r '.link // empty')
ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // empty')

if [ -z "$POST_ID" ]; then
  echo "❌ FAILED to publish test post."
  echo "Error: $ERROR_MSG"
  echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

echo "✅ Published! Post #$POST_ID: $POST_URL"
echo ""
echo "Fetching HTML source to check for <style> tags..."

# Grab the raw page HTML
RAW_HTML=$(curl -s "$WP_URL/$TEST_SLUG/")

STYLE_COUNT=$(echo "$RAW_HTML" | grep -c '<style>' || true)
ENTRY_CONTENT=$(echo "$RAW_HTML" | grep -oP '(?<=<div class="entry-content">).*?(?=</div>)' | head -c 500 || true)

if [ "$STYLE_COUNT" -gt 0 ]; then
  echo ""
  echo "✅ <style> tags SURVIVED! Found $STYLE_COUNT occurrence(s)."
  echo ""
  echo "Snippet is working. You can delete this test post from WP Admin → Posts."
  echo "Live URL: $POST_URL"
else
  echo ""
  echo "❌ <style> tags were STRIPPED by WordPress."
  echo ""
  echo "Possible causes:"
  echo "  1. The Code Snippets plugin snippet is not active (check WP Admin → Snippets)"
  echo "  2. Another plugin (Elementor, Wordfence, etc.) is also stripping <style> tags"
  echo "  3. The snippet has a PHP error (check Snippets → All Snippets → look for errors)"
fi

echo ""
echo "--- Raw entry-content snippet (first 500 chars) ---"
echo "$ENTRY_CONTENT"
