const BULK_UNFOLLOW_DELAY_MS = 8000;

let unfollowQueue = [];
let unfollowQueueRunning = false;
let unfollowQueueIndex = -1;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractUsernameFromUrl(url) {
  const m = url.match(/^https:\/\/(www\.)?instagram\.com\/([^\/?#]+)\/?/i);
  if (!m) return null;

  const firstSegment = m[2].toLowerCase();

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

  return m[2];
}

function broadcastMessage(message) {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function getInstagramTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        resolve(null);
        return;
      }
      resolve(tabs[0].id || null);
    });
  });
}

async function sendUnfollowToContentScript(item) {
  const targetTabId = await getInstagramTabId();

  if (!targetTabId) {
    throw new Error("Nessuna tab instagram.com trovata per eseguire l'unfollow.");
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      targetTabId,
      { type: "UNFOLLOW_USER", userId: item.userId, username: item.username },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

async function processUnfollowQueue() {
  if (unfollowQueueRunning) return;
  unfollowQueueRunning = true;

  broadcastMessage({
    type: "BULK_UNFOLLOW_STARTED",
    total: unfollowQueue.length
  });

  while (unfollowQueueIndex + 1 < unfollowQueue.length) {
    unfollowQueueIndex += 1;
    const item = unfollowQueue[unfollowQueueIndex];

    broadcastMessage({
      type: "BULK_UNFOLLOW_PROGRESS",
      phase: "dispatching",
      current: unfollowQueueIndex + 1,
      total: unfollowQueue.length,
      userId: item.userId,
      username: item.username
    });

    try {
      await sendUnfollowToContentScript(item);
    } catch (error) {
      broadcastMessage({
        type: "UNFOLLOW_ERROR",
        userId: item.userId,
        username: item.username,
        error: error?.message || String(error)
      });
    }

    const isLast = unfollowQueueIndex >= unfollowQueue.length - 1;
    if (!isLast) {
      broadcastMessage({
        type: "BULK_UNFOLLOW_PROGRESS",
        phase: "waiting",
        current: unfollowQueueIndex + 1,
        total: unfollowQueue.length,
        delayMs: BULK_UNFOLLOW_DELAY_MS,
        userId: item.userId,
        username: item.username
      });
      await sleep(BULK_UNFOLLOW_DELAY_MS);
    }
  }

  const completed = unfollowQueue.length;
  unfollowQueue = [];
  unfollowQueueIndex = -1;
  unfollowQueueRunning = false;

  broadcastMessage({
    type: "BULK_UNFOLLOW_FINISHED",
    total: completed
  });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FOLLOWING_RESULTS") {
    const data = message.data;

    chrome.storage.local.set({ followingResults: data }, () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("results.html")
      });
    });
    return;
  }

  if (message.type === "FOLLOWING_ERROR") {
    console.warn("[Background] Errore dal content script:", message.error);
    return;
  }

  if (message.type === "UNFOLLOW_USER") {
    const { userId, username } = message;
    unfollowQueue = [{ userId, username }];
    unfollowQueueIndex = -1;
    unfollowQueueRunning = false;
    processUnfollowQueue().catch(err => {
      console.warn("[Background] Errore processUnfollowQueue singolo:", err);
    });
    return;
  }

  if (message.type === "START_BULK_UNFOLLOW") {
    const users = Array.isArray(message.users) ? message.users : [];

    if (unfollowQueueRunning) {
      broadcastMessage({
        type: "BULK_UNFOLLOW_ALREADY_RUNNING",
        total: unfollowQueue.length
      });
      return;
    }

    unfollowQueue = users
      .filter(u => u && u.userId && u.username)
      .map(u => ({ userId: String(u.userId), username: String(u.username) }));

    unfollowQueueIndex = -1;

    processUnfollowQueue().catch(err => {
      console.warn("[Background] Errore processUnfollowQueue bulk:", err);
      unfollowQueue = [];
      unfollowQueueIndex = -1;
      unfollowQueueRunning = false;
      broadcastMessage({
        type: "BULK_UNFOLLOW_FINISHED",
        total: 0,
        error: err?.message || String(err)
      });
    });
    return;
  }

  if (message.type === "UNFOLLOW_DONE" || message.type === "UNFOLLOW_ERROR") {
    broadcastMessage(message);
    return;
  }
});