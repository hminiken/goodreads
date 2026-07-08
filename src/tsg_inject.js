// Injected on app.thestorygraph.com pages. Per book this adds:
//  - Star rating / review count and a Calibre-Web "in library" status badge
//    (unchanged from the old standalone "Storygraph More Info" extension,
//    always visible, loaded immediately)
//  - A two-tab box on listing/browse cards: "Summary" (book description,
//    fetched immediately) and "Libby"/"Overdrive" (availability lookup,
//    only fetched the first time that tab is clicked)
// On the single-book page (where the description is already shown natively
// by StoryGraph) only the availability lookup and library-status badge are
// added - a Summary tab there would just duplicate what's already on screen.

chrome.storage.sync.get(null, function (obj) {
    console.log('[TSG] full sync storage dump:', obj);
});

var tableUpdateCheckInterval = null;
// These match the defaults passed to chrome.storage.sync.get() below - they're the
// values in effect for any book processed before that async read resolves (e.g. the
// very first card, whose addBookData() runs via a zero-delay setTimeout). Using {}
// here was a bug: an empty object is truthy, so showLibrary looked "on" for exactly
// one book (whichever ran first) even when the real stored setting was false.
var showSummary = true;
var showReview = true;
var showLibrary = false;
var shelfmarkUrl = null;
var showFormat = {};


function injectTabStyles() {
    if (document.getElementById('tsg-tab-styles')) return;
    document.getElementsByTagName('body')[0].insertAdjacentHTML("beforebegin", `<style id="tsg-tab-styles">
        #AGtable a{text-decoration:none;}
        .ARcontainer {position:relative}
        .AGcol { position:relative}
        .ARSingleoneLine { max-width: 700px; white-space: nowrap; overflow:hidden }
        .ARListoneLine { max-width: 400px; white-space: nowrap; overflow:hidden }
        .ARshowMoreInSinglePage, .ARshowMoreInList { display: inline-block; margin-top: 4px; font-size: 0.85em; text-decoration: underline; }
        .ARhidden { display:none }
        .ARclicked { display:none }
        .ARresultstatus {white-space: nowrap}
        .ARfade {
            -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 30px), transparent 100%);
            mask-image: linear-gradient(to bottom, black calc(100% - 30px), transparent 100%);
        }
        .ARsmaller { font-size: 80% }
        .ARdesc { text-align: left; padding-left: 1px; }
        .ARrow { display: flex; }
        .TSGtabs { margin-top: 8px; margin-bottom: 8px; }
        .TSGtabButtons { display: flex; border-bottom: 1px solid #999; border-radius: 4px 4px 0 0; overflow: hidden; }
        .TSGtabBtn { flex: 1; padding: 4px 10px; background: #eeeeee; color: #555555 !important; border: none; cursor: pointer; font-size: 0.85em; font-family: inherit; }
        .TSGtabBtn.TSGtabActive { background: #ffffff; color: #111111 !important; font-weight: bold; box-shadow: inset 0 -2px 0 #3b82f6; }
        .TSGtabPanel { display: block !important; padding: 6px 0; }
        .TSGtabPanel.TSGtabPanelHidden { display: none !important; }
        </style>`);
}
injectTabStyles();

// ---------- title/author cleanup before sending to the Libby/Overdrive search ----------

function cleanTitleForSearch(title) {
    return title.replace(/\(.*\)/, "").replace(/^\s+|\s+$/g, '').replace(/[&|,]/g, ' ').replace(/: .*/, '').replace(/[ ]+/, ' ');
}
function cleanAuthorForSearch(author) {
    return (author || "").replace(/^\s+|\s+$/g, '').replace(/[&|,]/g, ' ').replace(/(?:^|\W)(?:[A-Z]\.)+/g, ' ').replace(/[ ]+/, ' ');
}

// ---------- Libby/Overdrive availability lookup + rendering ----------

function onClickShowMore(id) {
    return function (event) {
        event.preventDefault();
        const table = document.getElementById("AGAVAIL" + id);
        table.classList.remove("ARfade");
        const hiddenRows = table.children;
        for (var row of hiddenRows) {
            row.classList.remove("ARhidden");
            row.classList.add("ARrow");
        }
        const showMoreLink = document.getElementById("ARshowMore" + id);
        showMoreLink.classList.add("ARclicked");
    }
}

// Standalone availability box used on the single-book page (no tabs - the
// description is already visible on that page, so there's nothing to pair it with).
function createSingleBookAvailabilityBox(headerText, id) {
    return `<div class="col-span-8" id='AGtable${id}' style='position:relative'>
            <div class='ARcontainer'>
            <b>Availability on ${headerText}:</b>
            <div class='ARtable' id='AGAVAIL${id}'>
            </div>
            <a href='#' id='ARshowMore${id}' class='ARshowMoreInSinglePage ARhidden button Button--small '>show more</a>
            </div></div><br>`;
}

// The tab box shown on listing/browse cards. Tab 1 (Summary) is populated
// immediately by addDescription(); Tab 2's availability lookup is only
// requested once, the first time it's clicked (see wireTabBox).
// NOTE: attribute/class names here are deliberately namespaced (data-tsg-*,
// TSGtab*) rather than generic (data-tab, data-panel) - StoryGraph is a
// Rails/Stimulus app that plausibly has its own global CSS/JS keyed off
// generic tab-related attribute names, which silently fought our inline
// display toggle. Visibility is driven by our own !important class instead
// of inline styles so nothing on the host page can override it.
function createTabBox(id, headerText, includeSummaryTab) {
    const availPanel = `<div class="ARtable" id="AGAVAIL${id}"></div>
        <a href='#' id='ARshowMore${id}' class='ARshowMoreInList ARhidden button Button--small'>show more</a>`;

    if (!includeSummaryTab) {
        return `<div class="TSGtabs" id="TSGtabs${id}"><div class="TSGtabPanel">${availPanel}</div></div>`;
    }

    return `<div class="TSGtabs" id="TSGtabs${id}">
        <div class="TSGtabButtons">
            <button type="button" class="TSGtabBtn TSGtabActive" data-tsg-tab="summary">Summary</button>
            <button type="button" class="TSGtabBtn" data-tsg-tab="avail">${headerText}</button>
        </div>
        <div class="TSGtabPanel" data-tsg-panel="summary" id="TSGsummary${id}"></div>
        <div class="TSGtabPanel TSGtabPanelHidden" data-tsg-panel="avail">${availPanel}</div>
    </div>`;
}

// Wires tab-switch clicks; onRequestAvailability fires only the first time
// the availability tab is opened for this book. If there's no Summary tab
// (showSummary disabled) there's no tab to click, so fetch right away.
function wireTabBox(id, onRequestAvailability) {
    const box = document.getElementById("TSGtabs" + id);
    if (!box) return;

    const buttons = box.querySelectorAll(".TSGtabBtn");
    if (buttons.length === 0) {
        box.dataset.availRequested = "true";
        onRequestAvailability();
    }
    buttons.forEach((btn) => {
        btn.addEventListener("click", function (event) {
            event.preventDefault();
            buttons.forEach((b) => b.classList.remove("TSGtabActive"));
            btn.classList.add("TSGtabActive");
            box.querySelectorAll(".TSGtabPanel").forEach((panel) => {
                panel.classList.toggle("TSGtabPanelHidden", panel.dataset.tsgPanel !== btn.dataset.tsgTab);
            });
            if (btn.dataset.tsgTab === "avail" && !box.dataset.availRequested) {
                box.dataset.availRequested = "true";
                onRequestAvailability();
            }
        });
    });

    const showMoreLink = document.getElementById("ARshowMore" + id);
    if (showMoreLink) {
        showMoreLink.addEventListener("click", onClickShowMore(id));
    }
}

function requestAvailability(id, title, author) {
    console.debug('[TSG] requesting availability:', id, title, author);
    chrome.runtime.sendMessage({
        type: "FROM_AG_PAGE",
        id: id,
        title: cleanTitleForSearch(title),
        author: cleanAuthorForSearch(author)
    });
}

function limitResultsShown(id) {
    const table = document.getElementById("AGAVAIL" + id);
    const showMore = document.getElementById("ARshowMore" + id);
    if (!table || !showMore) return;

    if (table.children && !showMore.classList.contains("ARclicked")) {
        for (var i = 0, row; row = table.children[i]; i++) {
            if (i >= showFormat.limitResultCount) {
                row.classList.add("ARhidden");
                row.classList.remove("ARrow");
                showMore.classList.remove("ARhidden");
            } else {
                row.classList.remove("ARhidden");
                row.classList.add("ARrow");
            }
        }
        const delta = table.children.length - showFormat.limitResultCount;
        if (delta > 0) {
            showMore.textContent = "show " + delta + " more";
            showMore.classList.remove("ARhidden");
            table.classList.add("ARfade");
        } else {
            showMore.classList.add("ARhidden");
        }
    }
}

function insertRow(id, imgCol, descCol, sortScore, hideNotFoundIfOtherResults, notFoundOrder) {
    const matches = document.querySelectorAll('[id="AGAVAIL' + id + '"]');
    if (matches.length !== 1) {
        console.warn('[TSG] insertRow: expected exactly 1 #AGAVAIL' + id + ' in the DOM, found', matches.length);
    }
    const table = document.getElementById("AGAVAIL" + id);
    if (!table) {
        console.warn('[TSG] insertRow: no panel found for', id, '- dropping result');
        return;
    }
    console.debug('[TSG] insertRow: adding row to', id, '- panel visible:', table.offsetParent !== null, 'connected:', table.isConnected);

    if (table.children) {
        var i = 0, row = null;
        for (i = 0; row = table.children[i]; i++) {
            var rowSortScore = row.getAttribute("ARsortScore");
            if (sortScore < rowSortScore) {
                break;
            }
        }
        if (i == 0) {
            table.setAttribute("ARsortScore", sortScore);
        }
    }

    const rowDiv = document.createElement("div");
    rowDiv.classList.add("ARrow");
    table.insertBefore(rowDiv, row);

    const imgCell = document.createElement("div");
    imgCell.classList.add("ARimg");
    rowDiv.appendChild(imgCell);

    const descCell = document.createElement("div");
    descCell.classList.add("ARdesc");
    rowDiv.appendChild(descCell);

    rowDiv.setAttribute("ARsortScore", sortScore);
    imgCell.innerHTML = imgCol;
    descCell.innerHTML = descCol;

    if (hideNotFoundIfOtherResults) {
        if (table.children) {
            for (var i = 0, row; row = table.children[i]; i++) {
                var rowSortScore = row.getAttribute("ARsortScore");
                if (rowSortScore == notFoundOrder) {
                    table.removeChild(row);
                    break;
                }
            }
        }
    }

    if (showFormat.limitResultCount > 0) {
        limitResultsShown(id);
    }
}

function addOrUpdateNotFoundRow(message, resultsUrl, notFoundOrder, hideNotFoundIfOtherResults) {
    const table = document.getElementById("AGAVAIL" + message.id);
    if (!table) {
        console.warn('[TSG] addOrUpdateNotFoundRow: no panel found for', message.id, '- dropping result');
        return;
    }

    if (table.children) {
        for (var i = 0, row; row = table.children[i]; i++) {
            var rowSortScore = row.getAttribute("ARsortScore");
            if (rowSortScore == notFoundOrder) {
                if (!showFormat.hideLibrary) {
                    row.innerHTML = row.innerHTML.replace("\"> at ", "\"> at <a href='" + resultsUrl + "'>" + message.libraryShortName + "</a>, ");
                }
                return;
            } else if (hideNotFoundIfOtherResults) {
                return;
            }
        }
    }

    const statusColor = "gray";
    const statusText = "not found";
    const sortScore = notFoundOrder;

    var library = "";
    if (!showFormat.hideLibrary) {
        library = " at " + message.libraryShortName;
    }

    const descCol = "<div class=ARdesc><span><font color=" + statusColor + ">" + statusText + "</font><a href='" + resultsUrl + "'>" + library + "</a></span>" +
        "<br/>&nbsp;&nbsp;<span class='ARsmaller'>Searched for: <a href='" + resultsUrl + "'><i>" + message.searchTitle + "</i> by <i>" + message.searchAuthor + "</i></a></span></div>";

    insertRow(message.id, "<img>", descCol, sortScore, false, notFoundOrder);
}

function parseResultsMessage(message, sender, sendResponse) {
    // Bail out (without touching any properties) on anything that isn't a
    // FROM_AG_EXTENSION-shaped availability response - this listener receives
    // every runtime message delivered to this tab, not just ones meant for it.
    if (!message || !message.searchUrls || !Array.isArray(message.books)) {
        return;
    }

    try {
        renderAvailabilityResults(message);
    } catch (err) {
        console.error('[TSG] Failed to render availability results:', err, message);
    }
}

function renderAvailabilityResults(message) {
    console.debug('[TSG] received availability results:', message.id, message.libraryShortName, message.books.length, 'books');
    const endOfList = 99999999;
    const requestOrder = endOfList;
    const notFoundOrder = endOfList * 10;
    const errorOrder = endOfList * 100;
    const hideNotFoundIfOtherResults = message.hideNotFoundIfOtherResults;

    var resultsUrl = message.searchUrls.libby;
    if (showFormat.linkToOverdriveResults) {
        resultsUrl = message.searchUrls.overdrive;
    }

    for (const book of message.books) {
        var statusColor = "red";
        var statusText = "error searching";
        var sortScore = errorOrder;

        resultsUrl = book.libbyResultUrl;
        if (showFormat.linkToOverdriveResults) {
            resultsUrl = book.searchUrls.overdrive;
        }

        var audioStr = "";
        if (book.isAudio) {
            audioStr = "<span class=ARaudiobadge>🎧</span>";
        }

        if (book.alwaysAvailable) {
            statusText = "always available";
            statusColor = "#080";
            sortScore = endOfList * -1;
        } else if (book.totalCopies && book.holds != null && book.holds >= 0) {
            var holdsRatio = ", " + book.holds + "/" + book.totalCopies + " holds";
            var estimateStr = book.estimatedWaitDays;
            if (!estimateStr) {
                estimateStr = "no estimate" + holdsRatio;
                holdsRatio = "";
                sortScore = book.holds * 14 + 10;
            } else {
                estimateStr += estimateStr == 1 ? " day" : " days";
                sortScore = book.estimatedWaitDays + 10;
            }
            if (!message.showHoldsRatio) {
                holdsRatio = "";
            }
            statusColor = "#C80";
            statusText = estimateStr + holdsRatio;
        } else if (book.holds && isNaN(book.holds)) {
            statusColor = "#C80";
            statusText = "place hold";
            sortScore = requestOrder;
            if (book.estimatedWaitDays >= 0) {
                sortScore = book.estimatedWaitDays + 10;
            }
        } else if ((!book.availableCopies && book.isRecommendableToLibrary) || (!book.totalCopies == 0 && book.request)) {
            statusColor = "#C60";
            statusText = "request";
            sortScore = requestOrder;
        } else if (book.availableCopies > 0) {
            statusColor = "#080";
            statusText = book.availableCopies + " available";
            sortScore = book.availableCopies * -1;
        } else if (!book.totalCopies) {
            console.debug('[TSG]  book:', book.title, '-> not found (no totalCopies)');
            addOrUpdateNotFoundRow(message, resultsUrl, notFoundOrder, hideNotFoundIfOtherResults);
            continue;
        }
        console.debug('[TSG]  book:', book.title, '->', statusText);

        var imgCol = "";
        if (book.imgUrl) {
            var imgHeight = showFormat.oneLine ? 20 : 40;
            imgCol = "<a href='" + resultsUrl + "'><img style='max-width:30px' src='" + book.imgUrl + "' height=" + imgHeight + "px></a>";
        }

        var titleAndAuthor = "<br/>";
        var prependAudioStr = "";
        if (showFormat.oneLine) {
            titleAndAuthor = " - ";
        }
        if (showFormat.hideTitleAndAuthor) {
            titleAndAuthor = "";
            prependAudioStr = audioStr;
        } else {
            titleAndAuthor += "<span class='ARtitle'>" + audioStr + book.title + " by " + book.author + "</span>";
        }

        var library = "";
        if (!showFormat.hideLibrary) {
            library = " at " + message.libraryShortName;
        }

        const descCol = "<div class=ARdesc><span class=ARresultstatus><a href='" + resultsUrl + "'><font color='" + statusColor + "'>" + prependAudioStr + statusText + "</font></a>" +
            library + "</span>" +
            titleAndAuthor + "</div>";

        insertRow(message.id, imgCol, descCol, sortScore, hideNotFoundIfOtherResults, notFoundOrder);
    }

    if (!message.books || message.books.length == 0) {
        addOrUpdateNotFoundRow(message, resultsUrl, notFoundOrder, hideNotFoundIfOtherResults);
    }
}

chrome.runtime.onMessage.addListener(parseResultsMessage);

// ---------- summary / review / library status ----------
// StoryGraph occasionally drops/rate-limits requests when a burst of book cards
// renders at once (e.g. infinite scroll loading a page of new books). Retry
// transient failures a couple times before giving up; skip retrying permanent
// ones (auth/config errors) since they'll never succeed.
const isRetryableFetchError = (error) => {
    if (!error) return true;
    if (error === 'Calibre-Web not configured') return false;
    const httpMatch = /^HTTP (\d+)$/.exec(error);
    if (httpMatch) {
        const status = parseInt(httpMatch[1], 10);
        return status === 429 || status >= 500;
    }
    return true; // fetch() threw (network error) - worth retrying
};

const fetchWithRetry = async (fetchFn, retries = 2, delayMs = 700) => {
    let result = await fetchFn();
    let attempt = 0;
    while (!result.success && isRetryableFetchError(result.error) && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
        result = await fetchFn();
        attempt++;
    }
    return result;
};

const fetchData = async (url) => {
    try {
        const response = await fetch(url);
        const data = await response.text();
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Star rating and review count both live in this same turbo-frame response, so
// fetch it once and derive both from it - two separate fetches raced independently
// and appended whichever resolved first, producing inconsistent ordering.
const fetchCommunityReviews = async (url) => {
    try {
        const response = await fetch(url + "/community_reviews", {
            "credentials": "include",
            "headers": {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
                "Accept": "text/html, application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.5",
                "Turbo-Frame": "community_reviews",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin"
            },
            "referrer": url,
            "method": "GET",
            "mode": "cors"
        });

        const data = await response.text();
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

// Get the text from the response, optionally including the markers
const extractDescription = (data, startMarker, endMarker, inclusive) => {
    const startIndex = data.indexOf(startMarker);
    const endIndex = data.indexOf(endMarker, startIndex + startMarker.length);
    if (startIndex !== -1 && endIndex !== -1) {
        if (inclusive == true) {
            return data.substring(startIndex, endIndex + endMarker.length);
        }
        return data.substring(startIndex + startMarker.length, endIndex);
    }
    return null;
};

// The description is pulled out of an inline `.html('...')` JS string literal, so its
// escape sequences (\n, \', \\, etc.) need to be resolved back to real characters -
// blindly stripping backslashes turns "\n" into a stray "n" at each line break.
const unescapeJsStringLiteral = (str) => {
    return str.replace(/\\(n|t|r|'|"|\\|\/)/g, (_, ch) => {
        if (ch === 'n') return '<br>';
        if (ch === 't') return ' ';
        if (ch === 'r') return '';
        return ch; // \' -> ' , \" -> " , \\ -> \ , \/ -> /
    });
};

// Renders into the Summary tab panel created by createTabBox().
function addDescription(result, book_id, title_name) {
    var rawSection = extractDescription(result.data, '$(this).parent().parent().html(\'', '\')', false);
    if (rawSection) {
        var section = unescapeJsStringLiteral(rawSection);
        var div = document.getElementById('TSGsummary' + book_id);
        if (!div) {
            console.error('Could not find summary tab panel for', title_name);
            return;
        }
        div.innerHTML = "<div id=\"desc_scroll_" + book_id + "\" style=\"max-height: 150px; overflow-y: scroll;font-size: medium;scroll-behavior: smooth;\">"
            + section + "</div>";
    } else {
        console.error('Section not found in the response');
    }
}

// StoryGraph appends extra utility classes to these elements over time, so match
// on the stable class/href fragment via DOMParser instead of an exact-string search.
function addReviewInfo(result, book_id, title_name) {
    var div = document.querySelector('[data-book-id="' + book_id + '"].action-menu');
    if (!div) {
        var allMenus = document.querySelectorAll('.action-menu');
        console.warn('[TSG] addReviewInfo: no .action-menu for', book_id, title_name,
            '- found', allMenus.length, '.action-menu elements total, with data-book-id:',
            Array.from(allMenus).map((el) => el.dataset.bookId));
        return;
    }

    var doc = new DOMParser().parseFromString(result.data, 'text/html');
    var ratingEl = doc.querySelector('.average-star-rating');
    var reviewLink = doc.querySelector('a[href*="/book_reviews/"]');

    if (!ratingEl && !reviewLink) {
        console.error('Star rating / review count not found in the response for', title_name);
        return;
    }

    var ratingHtml = ratingEl
        ? '<div style="color:#FFDB77;font-weight:bold;font-size:1.1em;">★ ' + ratingEl.textContent.trim() + '</div>'
        : '';
    var reviewsHtml = reviewLink
        ? '<div style="font-size:0.85em;">' + reviewLink.textContent.trim() + '</div>'
        : '';

    var section = '<div id="review_info_' + book_id + '">' + ratingHtml + reviewsHtml + '</div>';
    div.innerHTML += section;
}

// The Calibre-Web-Automated OPDS lookup itself runs in background.js, not here:
// Firefox still subjects a content script's fetch() to the host page's CORS
// policy even when host_permissions covers the target, so a Calibre-Web server
// that doesn't send Access-Control-Allow-Origin gets silently blocked from this
// page. A background page's fetch isn't subject to that restriction. Retries
// also happen background-side, so this is a single fire-and-wait round trip.
let calibreRequestCounter = 0;
const pendingCalibreRequests = new Map();

function fetchCalibreStatus(title, author) {
    return new Promise((resolve) => {
        const requestId = 'calibre-' + (++calibreRequestCounter);
        console.debug('[TSG] sending calibre lookup:', requestId, title, '- pending count now', pendingCalibreRequests.size + 1);
        pendingCalibreRequests.set(requestId, resolve);
        chrome.runtime.sendMessage({
            type: 'FROM_TSG_CALIBRE_LOOKUP',
            requestId: requestId,
            title: title,
            author: author
        });
    });
}

chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.type === 'FROM_TSG_CALIBRE_RESULT' && pendingCalibreRequests.has(message.requestId)) {
        const resolve = pendingCalibreRequests.get(message.requestId);
        pendingCalibreRequests.delete(message.requestId);
        resolve(message.result);
    }
});

// If shelfmarkUrl contains the literal placeholder "{query}", swap in the
// URL-encoded title/author; otherwise just link straight to shelfmarkUrl.
function buildShelfmarkLink(title, author) {
    if (!shelfmarkUrl) return null;
    const query = encodeURIComponent(author ? `${title} ${author}` : title);
    return shelfmarkUrl.includes('{query}') ? shelfmarkUrl.replace('{query}', query) : shelfmarkUrl;
}

// Shared between the listing-card badge and the single-book-page badge so the
// label/color/link rules only live in one place.
function buildLibraryStatusContent(title_name, author_name, result) {
    var label, color;
    if (!result.success) {
        label = 'Library status unavailable';
        color = '#999999';
    } else if (result.found) {
        label = 'In Library';
        color = '#2e7d32';
    } else {
        label = 'Not in Library';
        color = '#b71c1c';
    }

    var innerHtml = label;
    if (result.success && result.found && result.calibreUrl && result.calibreBookId) {
        var calibreLink = result.calibreUrl.replace(/\/$/, '') + '/book/' + result.calibreBookId;
        innerHtml = '<a href="' + calibreLink + '" target="_blank" rel="noopener noreferrer" style="color:' + color + ';">' + label + '</a>';
    } else if (result.success && !result.found) {
        var shelfmarkLink = buildShelfmarkLink(title_name, author_name);
        if (shelfmarkLink) {
            innerHtml = '<a href="' + shelfmarkLink + '" target="_blank" rel="noopener noreferrer" style="color:' + color + ';">' + label + '</a>';
        }
    }

    return { color: color, innerHtml: innerHtml };
}

function addLibraryStatus(book_id, title_name, author_name, result) {
    var div = document.querySelector('[data-book-id="' + book_id + '"].action-menu');
    if (!div) {
        var allMenus = document.querySelectorAll('.action-menu');
        console.warn('[TSG] addLibraryStatus: no .action-menu for', book_id, title_name,
            '- found', allMenus.length, '.action-menu elements total, with data-book-id:',
            Array.from(allMenus).map((el) => el.dataset.bookId));
        return;
    }

    var content = buildLibraryStatusContent(title_name, author_name, result);
    var section = '<div id="library_status_' + book_id + '" style="font-weight:bold;color:' + content.color + ';">' + content.innerHtml + '</div>';
    div.innerHTML += section;
}

// The single-book page (e.g. /books/<id>) has a completely different layout from the
// listing cards - no `.book-pane[data-book-id]` wrapper or `.action-menu` - so it gets
// its own detection/render path instead of reusing the listing-card one.
function isSingleBookPage() {
    return /^\/books\/[0-9a-f-]+\/?$/.test(window.location.pathname);
}

function addSingleBookLibraryStatus() {
    if (!showLibrary || !isSingleBookPage()) return;
    if (document.getElementById('library_status_page')) return;

    var container = document.querySelector('.book-title-author-and-series');
    var titleEl = container ? container.querySelector('h3') : null;
    if (!container || !titleEl) return; // page hasn't finished rendering yet

    var title_name = titleEl.textContent.trim();
    var authorLink = container.querySelector('a[href^="/authors/"]');
    var author_name = authorLink ? authorLink.textContent.trim() : null;

    var div = document.createElement('div');
    div.id = 'library_status_page';
    div.style.fontWeight = 'bold';
    div.style.marginTop = '4px';
    div.textContent = 'Checking library…';
    container.appendChild(div);

    fetchCalibreStatus(title_name, author_name).then((result) => {
        var content = buildLibraryStatusContent(title_name, author_name, result);
        div.style.color = content.color;
        div.innerHTML = content.innerHtml;
    });
}

// Adds the standalone Libby/Overdrive availability box to the single-book page.
function addSingleBookAvailability() {
    if (!isSingleBookPage()) return;
    if (document.getElementById('AGtableSINGLEBOOK')) return;

    var container = document.querySelector('.book-title-author-and-series');
    var titleEl = container ? container.querySelector('h3') : null;
    if (!container || !titleEl) return; // page hasn't finished rendering yet

    var title_name = titleEl.textContent.trim();
    var authorLink = container.querySelector('a[href^="/authors/"]');
    var author_name = authorLink ? authorLink.textContent.trim() : null;

    var headerText = showFormat.linkToOverdriveResults ? "Overdrive" : "Libby";
    const id = "SINGLEBOOK";

    container.insertAdjacentHTML("afterend", createSingleBookAvailabilityBox(headerText, id));

    const showMoreLink = document.getElementById("ARshowMore" + id);
    if (showMoreLink) {
        showMoreLink.addEventListener("click", onClickShowMore(id));
    }

    requestAvailability(id, title_name, author_name || "");
}

function addDivs() {
    // Pass defaults directly to get() rather than writing them back to storage when
    // missing - a separate "write defaults if unset" step is a read-then-write race
    // against the options page's own writes (whichever write lands last wins), and
    // with fresh/empty storage (e.g. a new profile) that race loses often enough to
    // silently turn library-status checks back off mid-session.
    chrome.storage.sync.get(
        { showSummary: true, showReview: true, showLibrary: false, shelfmarkUrl: '', showFormat: {} },
        function (obj) {
            showSummary = obj.showSummary;
            showReview = obj.showReview;
            showLibrary = obj.showLibrary;
            shelfmarkUrl = obj.shelfmarkUrl;
            showFormat = obj.showFormat || {};
        }
    );

    // Each book card is a `.book-pane[data-book-id]` (it contains both a desktop and
    // mobile layout internally, so this selector already yields one match per book).
    var parentDivs = document.querySelectorAll('.book-pane[data-book-id]');

    // Stagger the fetch kickoff for a batch of newly-rendered cards (e.g. after
    // infinite scroll loads a page of books) instead of firing them all in the same
    // tick - bursts of simultaneous requests are what seem to get dropped/rate-limited.
    var newCardCount = 0;

    for (let parentDiv of parentDivs) {
        if (parentDiv.dataset.tsgProcessed === "true") {
            continue;
        }

        let bookID = parentDiv.dataset.bookId;
        if (!bookID) {
            continue;
        }

        let titleLink = parentDiv.querySelector('.book-title-author-and-series a[href^="/books/"]')
            || parentDiv.querySelector('a[href^="/books/"]');
        if (!titleLink) {
            // Card hasn't fully rendered yet; try again on the next pass.
            continue;
        }

        let title_link = titleLink.href;
        let title_name = titleLink.innerText.trim();

        let authorLink = parentDiv.querySelector('a[href^="/authors/"]');
        let authorName = authorLink ? authorLink.innerText.trim() : null;

        parentDiv.dataset.tsgProcessed = "true";

        // NOTE: these must be `let`, not `var` - wireTabBox's callback below is a
        // closure that only runs later (on click), long after this loop has finished.
        // With `var` every card's closure would share the same function-scoped
        // bindings and all end up requesting/rendering whichever book was processed
        // last in this batch, regardless of which book's tab was actually clicked.
        let headerText = showFormat.linkToOverdriveResults ? "Overdrive" : "Libby";
        parentDiv.insertAdjacentHTML("beforeend", createTabBox(bookID, headerText, showSummary !== false));
        wireTabBox(bookID, () => requestAvailability(bookID, title_name, authorName || ""));

        setTimeout(
            ((link, id, name, div, author) => () => addBookData(link, id, name, div, author))(title_link, bookID, title_name, parentDiv, authorName),
            newCardCount * 150
        );
        newCardCount++;
    }

    addSingleBookLibraryStatus();
    addSingleBookAvailability();

    if (tableUpdateCheckInterval == null) {
        tableUpdateCheckInterval = setInterval(function () {
            if (document.querySelectorAll('[class*="average-star-rating"]').length == 0) {
                addDivs();
            }
        }, 2000);
    }
}

function addBookData(link, book_id, title_name, parentDiv, author_name) {
    if (showLibrary) {
        console.debug('[TSG] checking library status for', book_id, title_name);
        fetchCalibreStatus(title_name, author_name).then(result => {
            console.debug('[TSG] library status result for', book_id, title_name, '->', result);
            var desc_id = document.getElementById("library_status_" + book_id);
            if (desc_id == null) {
                addLibraryStatus(book_id, title_name, author_name, result);
            }
        });
    }

    if (showReview) {
        fetchWithRetry(() => fetchCommunityReviews(link)).then(result => {
            var desc_id = document.getElementById("review_info_" + book_id);
            if (result.success) {
                if (desc_id == null) {
                    addReviewInfo(result, book_id, title_name);
                }
            } else {
                console.error('Failed to fetch review info for', title_name, ':', result.error);
            }
        });
    }

    if (showSummary) {
        fetchWithRetry(() => fetchData(link)).then(result => {
            var desc_id = document.getElementById("desc_scroll_" + book_id);
            if (result.success) {
                if (desc_id == null) {
                    addDescription(result, book_id, title_name);
                }
            } else {
                console.error('Failed to fetch description for', title_name, ':', result.error);
            }
        });
    }
}

const targetNode = document.body;
const config = { attributes: true, childList: true, subtree: true };

const callback = function (mutationsList, observer) {
    observer.disconnect(); // turn off observer to prevent infinite loop
    addDivs();
    observer.observe(targetNode, config);
};

const observer = new MutationObserver(callback);
observer.observe(targetNode, config);
