// Settings for the StoryGraph book-card features (Summary/Availability tabs,
// star rating & review count, Calibre-Web library status). Kept separate from
// settings.js, which owns the GoodReads/Overdrive library configuration.

const tsgSaveOptions = () => {
	const showSummary = document.getElementById('tsgSummary').checked;
	const showReview = document.getElementById('tsgReview').checked;
	const showLibrary = document.getElementById('tsgLibrary').checked;
	const calibreUrl = document.getElementById('tsgCalibreUrl').value.trim();
	const calibreUser = document.getElementById('tsgCalibreUser').value;
	const calibrePass = document.getElementById('tsgCalibrePass').value;
	const shelfmarkUrl = document.getElementById('tsgShelfmarkUrl').value.trim();

	const showStatus = () => {
		const status = document.getElementById('tsgStatus');
		status.textContent = 'Saved.';
		setTimeout(() => {
			status.textContent = '';
		}, 750);
	};

	chrome.storage.sync.set({ showSummary, showReview, showLibrary, shelfmarkUrl }, () => {
		// Credentials are kept out of sync storage so they aren't uploaded to the browser account
		chrome.storage.local.set({ calibreUrl, calibreUser, calibrePass }, showStatus);
	});
};

const tsgRestoreOptions = () => {
	chrome.storage.sync.get(
		{ showSummary: true, showReview: true, showLibrary: false, shelfmarkUrl: '' },
		(items) => {
			document.getElementById('tsgSummary').checked = items.showSummary;
			document.getElementById('tsgReview').checked = items.showReview;
			document.getElementById('tsgLibrary').checked = items.showLibrary;
			document.getElementById('tsgShelfmarkUrl').value = items.shelfmarkUrl;
		}
	);

	chrome.storage.local.get(
		{ calibreUrl: '', calibreUser: '', calibrePass: '' },
		(items) => {
			document.getElementById('tsgCalibreUrl').value = items.calibreUrl;
			document.getElementById('tsgCalibreUser').value = items.calibreUser;
			document.getElementById('tsgCalibrePass').value = items.calibrePass;
		}
	);
};

tsgRestoreOptions();

['tsgSummary', 'tsgReview', 'tsgLibrary'].forEach((id) => {
	document.getElementById(id).addEventListener('change', tsgSaveOptions);
});
['tsgCalibreUrl', 'tsgCalibreUser', 'tsgCalibrePass', 'tsgShelfmarkUrl'].forEach((id) => {
	document.getElementById(id).addEventListener('change', tsgSaveOptions);
});
