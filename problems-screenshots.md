
  Problems Found in Screenshots

  1. Detail panel clipped off-screen (chrome-deno 050-delete-detail-open.png)

  The detail panel opens but is clipped on the right edge - the title shows "A Cypher..."
   truncated, and action buttons (Debug, Export, Delete) are cut off. The panel doesn't
  have enough room or isn't positioned correctly relative to the viewport. The "Back"
  button is visible but the title and metadata are cut off at the right edge.

  2. "No preview available" in web search results (web-e2e 011-search-results.png)

  The search result shows Q: No preview available / A: Open bookmark details to view
  content instead of actual Q&A content. The bookmark was still in "processing" state
  (visible in 015-detail-panel-open.png which shows status "processing"). This means the
  search was performed before the server finished processing the bookmark's Q&A pairs, so
   the search result fell back to a placeholder.

  3. Bookmark title shows raw URL (web-e2e 008-library-bookmark-added.png,
  009-library-bookmark-card-visible.png)

  After adding a bookmark in the web app, the library card shows the raw URL
  http://127.0.0.1:36049/page/cyberspace-independence instead of the page title "A
  Declaration of the Independence of Cyberspace". The title extraction/sync hadn't
  completed yet. By contrast, the extension walkthrough correctly shows proper titles.

  4. Stumble page empty in web app (web-e2e 012-stumble-loaded.png)

  The stumble page shows "Showing 0 random bookmarks" and "No complete bookmarks to
  stumble through" despite having 1 bookmark. This is because stumble requires bookmarks
  with status "complete" (with markdown content), but the bookmark was still "processing"
   at that point.

  5. 009-api-config-saved-success.png missing save confirmation (chrome-deno)

  Screenshot 009 is named "saved success" but it looks identical to screenshot 008
  (models filled) - there's no visible success toast, banner, or visual feedback
  indicating the settings were actually saved. The user gets no confirmation that their
  save action worked.

  6. 018-bulk-import-started.png shows placeholder text in textarea (chrome-deno)

  After clicking Import, the textarea reverts to showing placeholder text (the ghost
  URLs) instead of the actual entered URLs. The validation message ("3 valid URLs") and
  progress bar are gone. This seems like the UI cleared the input prematurely before the
  import visually started.

  7. Duplicate screenshots 018/019 (chrome-deno)

  Screenshots 018 (bulk-import-started) and 019 (bulk-import-processing) are visually
  identical - both show "Downloaded 3/3, Completed 0/3" with a progress bar at the same
  position. The test may not have waited long enough between captures to show a
  meaningful intermediate state.

  8. Tags sidebar empty on Search page (chrome-deno 029-search-empty.png)

  The TAGS sidebar label is visible but no tags are listed underneath it, creating an
  awkward empty sidebar column that wastes space on the search page.

