chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;

  const url = tab.url || "";
  // Deve essere tipo: https://www.instagram.com/<username>/following/
  const isFollowingPage = /https:\/\/www\.instagram\.com\/[^/]+\/following\/?/i.test(url);

  if (!isFollowingPage) {
    // Mostra un piccolo avviso nella tab
    chrome.tabs.sendMessage(tab.id, {
      type: "SHOW_ERROR",
      message: "Vai prima sulla pagina dei following: https://www.instagram.com/<username>/following/"
    });
    return;
  }

  // Chiedi al content script di iniziare il fetch
  chrome.tabs.sendMessage(tab.id, { type: "FETCH_FOLLOWING" });
});

// Riceve i risultati dal content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FOLLOWING_RESULTS") {
    const data = message.data;

    chrome.storage.local.set({ followingResults: data }, () => {
      // Apri la pagina dei risultati
      chrome.tabs.create({
        url: chrome.runtime.getURL("results.html")
      });
    });
  }

  if (message.type === "FOLLOWING_ERROR") {
    console.warn("[Background] Errore dal content script:", message.error);
  }
});
