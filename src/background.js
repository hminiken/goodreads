// This is run in the backgrond

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  switch (message.type) {
    case 'FROM_AG_PAGE':
      console.log("SEND MESSAGE")
      searchOverdrive({
        messageId: message.id,
        title: message.title,
        author: message.author,
        tabId: sender.tab.id
      });
      break;
    case 'FROM_AGODLIB_PAGE':
      lookupOverdriveURL(message.libraryLink, message.libraryName, message.elementID, sender.tab.id);
      break;
    case 'FROM_TSG_CALIBRE_LOOKUP':
      console.log('[TSG-BG] lookup requested:', message.requestId, message.title, message.author);
      fetchCalibreStatusWithRetry(message.title, message.author).then((result) => {
        console.log('[TSG-BG] lookup result:', message.requestId, message.title, result);
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FROM_TSG_CALIBRE_RESULT',
          requestId: message.requestId,
          result: result
        });
      }).catch((err) => {
        console.error('[TSG-BG] lookup threw:', message.requestId, message.title, err);
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'FROM_TSG_CALIBRE_RESULT',
          requestId: message.requestId,
          result: { success: false, error: String(err) }
        });
      });
      break;
    }
});

// ---------- Calibre-Web-Automated library lookup (for tsg_inject.js) ----------
// Done here rather than in the content script: Firefox still subjects a content
// script's fetch() to the host page's CORS policy even when host_permissions
// covers the target, so a Calibre-Web server that doesn't send
// Access-Control-Allow-Origin gets silently blocked from the StoryGraph tab.
// A background page's fetch is not subject to that restriction.

// btoa() only handles Latin1; this widens it to support UTF-8 usernames/passwords
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

const normalizeForMatch = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Calibre commonly stores authors as "Last, First" while StoryGraph gives us "First
// Last" - compare as word sets so word order doesn't matter. Requires every word in
// the shorter name to appear in the longer one (handles co-author lists too).
const authorNamesOverlap = (a, b) => {
  const wordsA = new Set(a.split(' ').filter(Boolean));
  const wordsB = new Set(b.split(' ').filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  const [smaller, larger] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  for (const word of smaller) {
    if (!larger.has(word)) return false;
  }
  return true;
};

// Calibre's numeric book ID (used in the /book/<id> web UI URL) shows up embedded in
// an OPDS entry's acquisition/cover/thumbnail link hrefs, e.g. /opds/download/8/epub.
const extractCalibreBookId = (entry) => {
  const links = Array.from(entry.getElementsByTagName('link'));
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/opds\/(?:download|cover|thumb(?:_hd)?)\/(\d+)/);
    if (match) return match[1];
  }
  return null;
};

const isRetryableCalibreError = (error) => {
  if (!error) return true;
  if (error === 'Calibre-Web not configured') return false;
  const httpMatch = /^HTTP (\d+)$/.exec(error);
  if (httpMatch) {
    const status = parseInt(httpMatch[1], 10);
    return status === 429 || status >= 500;
  }
  return true; // fetch() threw (network error) - worth retrying
};

async function fetchCalibreStatusOnce(title, author) {
  const creds = await new Promise((resolve) => {
    chrome.storage.local.get(['calibreUrl', 'calibreUser', 'calibrePass'], resolve);
  });

  if (!creds.calibreUrl || !creds.calibreUser || !creds.calibrePass) {
    return { success: false, error: 'Calibre-Web not configured' };
  }

  // Search by title alone - combining title+author into one OPDS query risks being
  // too narrow if the server does a literal/phrase match rather than tokenized AND -
  // then verify title+author precisely against each returned entry client-side.
  const searchUrl = creds.calibreUrl.replace(/\/$/, '') + '/opds/search/' + encodeURIComponent(title);

  try {
    console.log('[TSG-BG] fetching:', searchUrl);
    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': 'Basic ' + toBase64(creds.calibreUser + ':' + creds.calibrePass),
        'Accept': 'application/atom+xml'
      }
    });
    console.log('[TSG-BG] response for', title, '-', response.status);

    if (!response.ok) {
      return { success: false, error: 'HTTP ' + response.status };
    }

    const text = await response.text();
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const entries = Array.from(xml.getElementsByTagName('entry'));

    const targetTitle = normalizeForMatch(title);
    const targetAuthor = normalizeForMatch(author);

    const match = entries.find((entry) => {
      const entryTitleEl = entry.getElementsByTagName('title')[0];
      const entryTitle = normalizeForMatch(entryTitleEl ? entryTitleEl.textContent : '');
      const titleMatches = entryTitle && (entryTitle === targetTitle || entryTitle.includes(targetTitle) || targetTitle.includes(entryTitle));
      if (!titleMatches) return false;
      if (!targetAuthor) return true;

      const authorNames = Array.from(entry.getElementsByTagName('author')).map((a) => {
        const nameEl = a.getElementsByTagName('name')[0];
        return normalizeForMatch(nameEl ? nameEl.textContent : '');
      });
      return authorNames.some((a) => a && authorNamesOverlap(a, targetAuthor));
    });

    return {
      success: true,
      found: !!match,
      calibreUrl: creds.calibreUrl,
      calibreBookId: match ? extractCalibreBookId(match) : null
    };
  } catch (error) {
    console.error('[TSG-BG] fetch threw for', title, ':', error);
    return { success: false, error: error.message };
  }
}

async function fetchCalibreStatusWithRetry(title, author, retries = 2, delayMs = 700) {
  let result = await fetchCalibreStatusOnce(title, author);
  let attempt = 0;
  while (!result.success && isRetryableCalibreError(result.error) && attempt < retries) {
    console.log('[TSG-BG] retrying', title, '- attempt', attempt + 1, 'after error:', result.error);
    await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    result = await fetchCalibreStatusOnce(title, author);
    attempt++;
  }
  return result;
}

// when installed for the first time, show the options page first
chrome.runtime.onInstalled.addListener(
  async function(details) {
    if (details.reason == "install") {
      var optionsURL = "src/options/index.html";
      chrome.tabs.create({
        url: optionsURL
      });
    }   
  }
);

async function lookupOverdriveURL(libraryLink, libraryName, elementID, tabId) {
  fetch(libraryLink).then(function(response) {
    var url = response.url.replace("https://", "").replace("/", "");
    chrome.tabs.sendMessage(tabId, {
      type: 'FROM_AG_EXTENSION',
      libraryName: libraryName,
      libraryLink: url,
      elementID: elementID
    });
  })
  .catch(function() {
    chrome.tabs.sendMessage(tabId, {
      type: 'FROM_AG_EXTENSION',
      libraryName: "ERROR",
      libraryLink: "",
      elementID: elementID
    });
  });
}

function createSearchUrls(library, libraryShortName, requestInfo, showFormat) {
  var searchUrls = {};

  var ebookParam = "";
  if (showFormat && showFormat.eBook) {
    ebookParam = "ebook-overdrive,ebook-media-do,ebook-overdrive-provisional";
  }
  var audiobookParam = "";
  if (showFormat && showFormat.audioBook) {
    audiobookParam = "audiobook-overdrive,audiobook-overdrive-provisional";
    if(ebookParam) {
      audiobookParam = "," + audiobookParam;
    }
  }

  searchUrls.overdriveAPI = "https://thunder.api.overdrive.com/v2/libraries/" + libraryShortName + 
    "/media?title=" + encodeURIComponent(requestInfo.title) + 
    "&creator=" + encodeURIComponent(requestInfo.author) + 
    "&format=" + ebookParam + audiobookParam + 
    "&perPage=24&page=1&x-client-id=dewey";

  searchUrls.libby = "https://libbyapp.com/search/" + libraryShortName + 
    "/search/title-" + encodeURIComponent(requestInfo.title) + 
    "/creator-" + encodeURIComponent(requestInfo.author) + "/page-1";

  searchUrls.overdrive = "https://" + libraryShortName + 
  ".overdrive.com/search?title=" + encodeURIComponent(requestInfo.title) + 
    "&creator=" + encodeURIComponent(requestInfo.author);
        
  return searchUrls;
}

function searchOverdrive(requestInfo) {
  console.log("search OVerdrive")
  // load strings for different libraries
  chrome.storage.sync.get(null, async function(obj) {
    var libraries = obj.libraries;
    var showFormat = obj.showFormat;

      for (var libraryIndex in libraries) {
        var library = libraries[libraryIndex];
        // just get the library short name from the domain
        var libraryShortName = library.url.replace(/\..*/, '');
        // if only checking one library, don't show the name in the results
        var libraryStr = "";
        if (Object.keys(libraries).length != 1) {
          libraryStr = "<br/>" + libraryShortName;
        }

        const searchUrls = createSearchUrls(library, libraryShortName, requestInfo, showFormat);

        const response = await fetch(searchUrls.overdriveAPI);
        const data = await response.json();
        parseOverdriveResults(data, {
            title: requestInfo.title,
            author: requestInfo.author,
            messageId: requestInfo.messageId,
            tabId: requestInfo.tabId,
            libraryShortName: libraryShortName,
            libraryStr: libraryStr,
            libraryIndex: libraryIndex,
            newDesign: library.newDesign,
            searchTitle: requestInfo.title,
            searchAuthor: requestInfo.author,
            searchUrls: searchUrls,
            hideNotFoundIfOtherResults: showFormat.hideNotFoundIfOtherResults,
            showHoldsRatio: showFormat.showHoldsRatio,
            showFormat: showFormat
          });
      }
  });
}

// parse the Libby results page
function parseOverdriveResults(data, requestInfo) {
  var books = [];

  for (const book of data.items) {
    var imgUrl = "";
    if (book.covers && Object.keys(book.covers) && Object.keys(book.covers).length > 0) {
      imgUrl = book.covers[Object.keys(book.covers)[0]].href;
    }
    if (requestInfo.showFormat && !requestInfo.showFormat.eBook && book.type.id == "ebook") {
      continue;
    }
    if (requestInfo.showFormat && !requestInfo.showFormat.audioBook && book.type.id == "audiobook") {
      continue;
    }
    books.push({
      title: book.title,
      author: book.firstCreatorName,
      availableCopies: book.availableCopies,
      totalCopies: book.ownedCopies,
      holds: book.isAvailable ? null : book.holdsCount,
      isAudio: book.type.id == "audiobook",
      alwaysAvailable: book.availabilityType == "always",
      overdriveUrl: "http://" + requestInfo.libraryShortName + ".overdrive.com/media/" + book.id,
      searchUrls: requestInfo.searchUrls,
      libbyResultUrl: "https://libbyapp.com/library/" + requestInfo.libraryShortName + "/spotlight-random/page-1/" + book.id,
      overdriveResultUrl: "https://" + requestInfo.libraryShortName + ".overdrive.com/media/" + book.id,
      estimatedWaitDays: book.estimatedWaitDays,
      imgUrl: imgUrl,
      isRecommendableToLibrary: book.isRecommendableToLibrary
    });
  }

  // send the book results list back to the tab
  chrome.tabs.sendMessage(requestInfo.tabId, {
    type: 'FROM_AG_EXTENSION' + requestInfo.messageId,
    id: requestInfo.messageId,
    libraryShortName: requestInfo.libraryShortName,
    libraryStr: requestInfo.libraryStr,
    searchTitle: requestInfo.searchTitle,
    searchAuthor: requestInfo.searchAuthor,
    searchUrls: requestInfo.searchUrls,
    books: books,
    hideNotFoundIfOtherResults: requestInfo.hideNotFoundIfOtherResults,
    showHoldsRatio: requestInfo.showHoldsRatio
  });
}
