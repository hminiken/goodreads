var libraryDivPlaceholders = "";
var tableUpdateCheckInterval = null;
var showOnPages = {};
var showFormat = {};
var libraryClassNames = [];
var waitingOnAvailability = false;
var loaded = false;



// wait for the document to load before injecting code
window.addEventListener("load", (event) => injectAvailableReads);
// if in Firefox we missed the load event, add after a delay
setTimeout(injectAvailableReads, 3000);

function createSingleBookPageTable(headerText, id) {
    return `<div class="col-span-8" id='AGtable' style='position:relative'>
            <div class='ARcontainer'>
            <b>Availability on ${headerText}:</b>\
            <div class='ARtable' id='AGAVAIL${id}'>
            </div>
            <a href='#' id='ARshowMore${id}' class='ARshowMoreInSinglePage ARhidden button Button--small '>show more
            <button type="button" class="Button Button--inline Button--small"><span class="Button__labelItem">
            <i class="Icon ChevronIcon">
            <svg viewBox="0 0 24 24"><path d="M8.70710678,9.27397892 C8.31658249,8.90867369 7.68341751,8.90867369 7.29289322,9.27397892 C6.90236893,9.63928415 6.90236893,10.2315609 7.29289322,10.5968662 L12,15 L16.7071068,10.5968662 C17.0976311,10.2315609 17.0976311,9.63928415 16.7071068,9.27397892 C16.3165825,8.90867369 15.6834175,8.90867369 15.2928932,9.27397892 L12,12.3542255 L8.70710678,9.27397892 Z" transform="rotate(0 12 12)"></path></svg></i></span></button>
            </a></div></div>`
};
function onClickShowMore(id) {
    return function (event) {
        event.preventDefault();

        const table = document.getElementById("AGAVAIL" + id);
        table.classList.remove("ARfade");

        const hiddenRows = table.children;
        for (var row of hiddenRows) {
            row.classList.remove("ARhidden");
            row.classList.add("ARrow");
        };

        const showMoreLink = document.getElementById("ARshowMore" + id);
        showMoreLink.classList.add("ARclicked");
    }
}

function getOverdriveAvailability() {
    console.log("getOverdriveAvailability")
    /*if (!libraryDivPlaceholders || libraryDivPlaceholders.length == 0) {
        return;
    }*/

    // check for tags on either a single book review page or the bookshelf page
    var book = document.querySelector("h1.Text__title1");
    var booklist = document.querySelectorAll('.responsiveBook');
    var booklist2 = document.querySelectorAll('table.tableList tr');
    var bookshelves = document.querySelectorAll('div#shelvesSection');

    //Mine
    var tbr = document.querySelectorAll('.to-read-books')


    var headerText = "Libby";
    if (showFormat.linkToOverdriveResults) {
        headerText = "Overdrive";
    }

    // if a single book page
    if (showOnPages["descriptionPage"] && book && !document.querySelector("div#AGtable")) {
        const id = "SINGLEBOOK";

        // inject the table we're going to populate
        document.querySelector('.BookPageMetadataSection__description')
            .insertAdjacentHTML("afterend", createSingleBookPageTable(headerText, id));

        const showMoreLink = document.getElementById("ARshowMore" + id);
        showMoreLink.addEventListener("click", onClickShowMore(id));

        if (showFormat.oneLine) {
            const div = document.getElementById("AGAVAIL" + id);
            div.classList.add("ARSingleoneLine");
        }

        // send a message for the background page to make the request
        chrome.runtime.sendMessage({
            type: "FROM_AG_PAGE",
            id: id,
            title: cleanTitleForSearch(book.textContent),
            author: cleanAuthorForSearch(document.querySelector(".ContributorLink__name").textContent)
        });
    }  else if (tbr && tbr.length > 0) { //mine: if on tsg tbr page
        console.log("TBR");
        const id = "TBR";

        // inject the table we're going to populate
        var parentDivs = document.getElementsByClassName('col-span-8 grid grid-cols-8 gap-2 border border-darkGrey dark:border-darkerGrey rounded-sm');
        var parentDiv = parentDivs[0];
        // for (let parentDiv of parentDivs)   {
        console.log(parentDiv);
        parentDiv.insertAdjacentHTML("afterend", createSingleBookPageTable(headerText, id));

        const showMoreLink = document.getElementById("ARshowMore" + id);
        showMoreLink.addEventListener("click", onClickShowMore(id));

        if (showFormat.oneLine) {
            const div = document.getElementById("AGAVAIL" + id);
            div.classList.add("ARSingleoneLine");
        }

        var book = parentDiv.querySelector('a').innerText;
        console.log("TBR BOOK");
        console.log(book);
        book_title = parentDiv.querySelectorAll('a')[0].innerText;
        book_author = parentDiv.querySelectorAll('a')[3].innerText;
        console.log(book_title);
        console.log(book_author);


        chrome.runtime.sendMessage({
            type: "FROM_AG_PAGE",
            id: id,
            title: book_title,
            author: book_author
        });
        

        // start a check every 2 seconds if new rows are added in case infinte scrolling is on
        //   or if a book's position is manually changed
        if (tableUpdateCheckInterval == null) {
            tableUpdateCheckInterval = setInterval(function () {
                if (document.querySelectorAll("tr.bookalike:not(.AGseen)").length > 0) {
                    getOverdriveAvailability();
                }
                // sort rows by availability if necessary
                if (waitingOnAvailability) {
                    sortRowsByStatus();
                }
            }, 2000);
        }
    }
}



function injectAvailableReads() {
    console.log("injectAvailableReads");
    if (!loaded) {
        loaded = true;
        // if document has been loaded, inject CSS styles
    
        chrome.storage.sync.get(null, function (obj) {
            showOnPages = obj["showOnPages"];
            showFormat = obj["showFormat"];

            getOverdriveAvailability();
        });
    }
};

function parseResultsMessage(message, sender, sendResponse) {
    console.log("ParseResults");
    const endOfList = 99999999;
    const requestOrder = endOfList;
    const notFoundOrder = endOfList * 10;
    const errorOrder = endOfList * 100;
    const hideNotFoundIfOtherResults = message.hideNotFoundIfOtherResults;

    if (!message || !message.searchUrls || message.searchUrls === undefined) {
        console.log(message);
    }
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

        // if an audiobook, add a headphone icon
        if (book.isAudio) {
            audioStr = "<span class=ARaudiobadge>🎧</span>";
        } else {
            audioStr = "";
        }

        if (book.alwaysAvailable) { // if always available
            statusText = "always available";
            statusColor = "#080";
            sortScore = endOfList * -1;

        } else if (book.totalCopies && book.holds != null && book.holds >= 0) { // if there's a wait list with count
            var holdsRatio = ", " + book.holds + "/" + book.totalCopies + " holds";

            var estimateStr = book.estimatedWaitDays;
            if (!estimateStr) {
                estimateStr = "no estimate" + holdsRatio;
                holdsRatio = "";
                sortScore = book.holds * 14 + 10;
            } else {
                if (estimateStr == 1) {
                    estimateStr += " day"
                } else {
                    estimateStr += " days"
                }
                sortScore = book.estimatedWaitDays + 10;
            }

            if (!message.showHoldsRatio) {
                holdsRatio = "";
            }

            statusColor = "#C80";
            statusText = estimateStr + holdsRatio;

        } else if (book.holds && isNaN(book.holds)) { // if there's a wait list with no count
            statusColor = "#C80";
            statusText = "place hold";
            sortScore = requestOrder;
            if (book.estimatedWaitDays >= 0) {
                sortScore = book.estimatedWaitDays + 10;
            }

        } else if ((!book.availableCopies && book.isRecommendableToLibrary) || (!book.totalCopies == 0 && book.request)) { // if no copies but request is an option
            statusColor = "#C60";
            statusText = "request";
            sortScore = requestOrder;

        } else if (book.availableCopies > 0) { // if available copies found with count
            statusColor = "#080";
            statusText = book.availableCopies + " available";
            sortScore = book.availableCopies * -1;

        } else if (!book.totalCopies) { // if no copies found
            addOrUpdateNotFoundRow(message, resultsUrl, notFoundOrder, hideNotFoundIfOtherResults);
            continue;
        }

        var imgCol = "";
        if (book.imgUrl) {
            var imgHeight = 40;
            if (showFormat.oneLine) {
                imgHeight = 20;
            }

            imgCol = "<a href='" + resultsUrl + "'><img style='max-width:30px' src='" + book.imgUrl + "' height=" + imgHeight + "px></a>";
        }

        var titleAndAuthor = "<br/>";
        var prependAudioStr = "";
        if (showFormat.oneLine) {
            titleAndAuthor = " - "
        }
        if (showFormat.hideTitleAndAuthor) {
            titleAndAuthor = "";
            prependAudioStr = audioStr;
        } else {
            titleAndAuthor += "<span class='ARtitle'>" + audioStr + book.title + " by " + book.author + "</span>"
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

console.log("end of tsg injecct")