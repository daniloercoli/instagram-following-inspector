chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;

  const url = tab.url || "";

  // Deve essere su instagram.com
  const isInstagram = /^https:\/\/(www\.)?instagram\.com\//i.test(url);

  if (!isInstagram) {
    console.warn("[Background] Tab non è instagram.com, non mando messaggi al content script.");
    return;
  }

  // Deve essere tipo: https://www.instagram.com/<username>/following/
  const isFollowingPage = /^https:\/\/www\.instagram\.com\/[^/]+\/following\/?/i.test(url);

  if (!isFollowingPage) {
    // Proviamo a mostrare un piccolo avviso nella tab
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: "SHOW_ERROR",
        message: "Vai prima sulla pagina dei following: https://www.instagram.com/<username>/following/"
      },
      () => {
        if (chrome.runtime.lastError) {
          // Qui intercettiamo "Could not establish connection. Receiving end does not exist."
          console.warn(
            "[Background] Impossibile inviare SHOW_ERROR al content script:",
            chrome.runtime.lastError.message
          );
        }
      }
    );
    return;
  }

  // Chiedi al content script di iniziare il fetch
  chrome.tabs.sendMessage(
    tab.id,
    { type: "FETCH_FOLLOWING" },
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
