# Available Reads TSG

A browser extension that shows you whether a book is available to borrow from
your local library — right on the page you're already browsing. It started as
a fork of [rhollister/goodreads](https://github.com/rhollister/goodreads)
("Available Reads") and adds full support for
[TheStoryGraph](https://app.thestorygraph.com), plus book summaries, star
ratings, and a personal Calibre-Web-Automated library lookup.

## What it does

### On GoodReads and OverDrive
On `goodreads.com` book pages, bookshelves, and Listopia lists, the extension
searches your chosen library/libraries' Libby (OverDrive) catalog for each
book and adds an inline availability listing — available now, on hold, wait
time, etc. — with a link straight to the title in Libby (or OverDrive, if you
prefer).

### On TheStoryGraph
On `app.thestorygraph.com` pages, each book card gets a small tabbed box:

- **Summary tab** — the book's description, pulled from the page and made
  scrollable/expandable so long summaries don't take over the layout.
- **Libby tab** — the same Libby/OverDrive availability check as above,
  fetched only when you click into the tab (so it doesn't slow down page load
  by checking every book on screen at once).

Alongside the tabs, StoryGraph book cards can also show:

- **Star rating & review count**, pulled directly from the page.
- **Library status**, checked against your own
  [Calibre-Web-Automated](https://github.com/crocodilestick/Calibre-Web-Automated)
  server — so you can see at a glance whether you already own a copy, in
  addition to whether it's available through Libby.

All three StoryGraph features (summary, rating/reviews, library status) can be
toggled independently in the options page.

## Installation

This is a personal fork, not published to any extension store. To use it:

1. Clone/download this repository.
2. In Firefox, go to `about:debugging#/runtime/this-firefox` → **Load
   Temporary Add-on** → select `manifest.json` inside the `goodreads` folder.
   (Or run it with [`web-ext run`](https://github.com/mozilla/web-ext) for a
   session that reloads automatically on file changes.)
3. Open the extension's options page (right-click the toolbar icon → Manage
   Extension → Preferences, or `about:addons`) to add your library and
   configure StoryGraph settings.

The original upstream project (without StoryGraph support) is available on
the [Chrome Web Store](https://chrome.google.com/webstore/detail/available-goodreads/gclnfffacbjpclfenjgefpfnafmjghhk?hl=en),
[Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/available-reads/),
and [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/available-reads/aapmmnijbakhcbdechnnpaikcdmefdeh)
if you just want the GoodReads/OverDrive functionality.

## Settings

The options page is split into a few cards:

### Add Your Libraries
Find your library on [OverDrive's library search map](https://www.overdrive.com/libraries)
and click "Add this library to Available Reads" to add it automatically. You
can add more than one library — the extension checks all of them and shows
the best result for each book.

If a library doesn't show up on the map (common for consortiums), use **Add a
library manually** below it: give the library a name and its OverDrive URL
(must contain `.overdrive.com`) — see the "Finding your library's OverDrive
URL" section at the bottom of the page for tips on tracking that URL down.
**Libraries added** lists everything currently configured; select one and hit
**Delete selected** to remove it.

### Availability Display Preferences
Controls how the Libby/OverDrive results themselves look, on both GoodReads
and StoryGraph:

| Setting | What it does |
|---|---|
| Import/Export Preferences | Save your entire configuration (libraries, display settings, StoryGraph settings) to a JSON file, or load one back in. Handy for syncing to a second device manually or backing up before making changes. |
| Number of results to show at a time | Caps how many library results are shown per book before collapsing the rest behind a "show more" link. `0` shows everything at once. |
| Link to Overdrive search results instead of Libby results | By default, results link to Libby; check this to link to the OverDrive site instead. |
| Show holds/copies ratio next to estimated wait time | Adds the raw "X holds / Y copies" number alongside the estimated wait, instead of just the wait estimate. |
| Only show "not found" if no other results | If you've added multiple libraries, hides the "not found" message from libraries that don't have the book as long as at least one other library does. |
| Compact results to one line | Squeezes each library's result onto a single line instead of a title/author line plus a status line. |
| Don't show library names in results | Hides which library each result came from — useful if you only have one library configured. |
| Don't show title and authors in results | Hides the repeated title/author text under each result (useful in compact/one-line mode). |
| Show availability for: eBooks / Audiobooks | Filters which formats are checked and displayed. |

### StoryGraph book cards
Settings specific to the tabbed box injected on `app.thestorygraph.com`:

| Setting | What it does |
|---|---|
| Book Summaries | Shows the Summary tab with the book's description. |
| Star Rating & Review Count | Shows StoryGraph's own rating and review count next to the book. |
| Library Status (Calibre-Web) | Shows whether the book is already in your Calibre-Web-Automated library. Requires the connection info below. |
| Calibre-Web-Automated connection — URL / Username / Password | Your Calibre-Web-Automated server address and login, used to look up whether a title is already in your library. **These credentials are stored locally on this device only** (`chrome.storage.local`), not synced to your browser account like the rest of your settings, so they aren't sent anywhere but your own Calibre-Web server. |
| Shelfmark link | An optional URL template used for a "not in library" link (e.g. to a want-to-read/shelfmark tracker). Include `{query}` where the title/author should be inserted to pre-fill a search; leave it out to just link to the site as-is. |

### About / detailed information
A collapsible reference at the bottom of the page explaining what each
availability label/color/icon means (e.g. green "available now" vs. amber
"25 days" wait estimate vs. gray "not found"), plus a walkthrough of a few
different ways to track down your library's OverDrive URL if it isn't on the
library search map.

## How results are found
For GoodReads/StoryGraph, the extension searches each configured library's
Libby catalog by title and author for every book on the page, then renders
whatever it finds inline. For Calibre-Web library status, it performs an OPDS
search against your configured server. Both lookups happen in the
extension's background script (not the page itself) so they aren't blocked by
the page's CORS policy.

## Privacy
- Library list, display preferences, and StoryGraph toggles are stored with
  `chrome.storage.sync`, so they follow you across devices signed into the
  same browser account.
- Calibre-Web credentials are stored with `chrome.storage.local` and are
  never synced or sent anywhere except directly to the server URL you
  configure.
- No data is sent to any third party beyond the library/Calibre servers you
  explicitly configure.

<!-- ## Using it on your phone
To use this extension on Android (unfortunately [Firefox Nightly is not
available on iOS](https://support.mozilla.org/en-US/kb/add-ons-firefox-ios)):

1. Download and install [Firefox Nightly](https://play.google.com/store/apps/details?id=org.mozilla.fenix&hl=en_US&gl=US).
2. Follow [Mozilla's directions to install a custom add-on](https://support.mozilla.org/en-US/kb/extended-add-support):
   1. Tap the three-dot menu and select **Settings**.
   2. Tap **About Firefox Nightly**.
   3. Tap the Firefox Nightly logo five times until "Debug menu enabled" appears.
   4. Go back to **Settings** — you'll now see **Custom Add-on collection**; open it.
   5. Use `14273671` for the collection owner id and `AvailableReads` for the
      name (this installs the original upstream add-on; this fork's
      StoryGraph features currently require loading it manually as a
      temporary add-on, which Firefox for Android's debug bridge also
      supports).
   6. Tap **OK** — the app will restart.
3. Export your desktop browser's preferences (Availability Display
   Preferences → Export Preferences) and import them on mobile to carry over
   your library setup. -->

## Credits
Originally created by [rhollister](https://github.com/rhollister); StoryGraph
support, Calibre-Web integration, and the tabbed book-card UI were added on
top of that base.
