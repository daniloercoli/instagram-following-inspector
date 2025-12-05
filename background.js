function extractUsernameFromUrl(url) {
  const m = url.match(/^https:\/\/www\.instagram\.com\/([^\/?#]+)\/?/i);
  if (!m) return null;

  const firstSegment = m[1].toLowerCase();

  // Segmenti "speciali" che NON sono username
  const reserved = new Set([
    "explore",
    "accounts",
    "reels",
    "p",
    "stories",
    "direct",
    "tv",
    "developer",
    "about",
    "legal"
  ]);

  if (reserved.has(firstSegment)) {
    return null;
  }

  return m[1]; // username così com'è (case sens.)
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;

  const url = tab.url || "";

  const isInstagram = /^https:\/\/(www\.)?instagram\.com\//i.test(url);
  if (!isInstagram) {
    console.warn("[Background] Tab non è instagram.com, non mando messaggi al content script.");
    return;
  }

  const username = extractUsernameFromUrl(url);

  if (!username) {
    // Non siamo su una pagina profilo
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: "SHOW_ERROR",
        message: "Vai prima su una pagina profilo, ad es. https://www.instagram.com/<username>/"
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[Background] Impossibile inviare SHOW_ERROR al content script:",
            chrome.runtime.lastError.message
          );
        }
      }
    );
    return;
  }

  // Siamo su una pagina profilo: avvia il processo
  chrome.tabs.sendMessage(
    tab.id,
    { type: "FETCH_FOLLOWING", username },
    () => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Background] Impossibile inviare FETCH_FOLLOWING al content script:",
          chrome.runtime.lastError.message
        );
      }
    }
  );
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
