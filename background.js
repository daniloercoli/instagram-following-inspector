const BULK_UNFOLLOW_DELAY_MS = 8000;

let unfollowQueueRunning = false;
let unfollowQueueTotal = 0;

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
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.ok !== true) {
          reject(new Error(response?.error || "Nessuna conferma dal content script. Ricarica la pagina Instagram."));
          return;
        }
        resolve();
      }
    );
  });
}

async function processUnfollowQueue(users) {
  if (unfollowQueueRunning) return;
  unfollowQueueRunning = true;
  unfollowQueueTotal = users.length;
  let attempted = 0;
  let succeeded = 0;
  let error = null;

  broadcastMessage({
    type: "BULK_UNFOLLOW_STARTED",
    total: users.length
  });

  try {
    for (const item of users) {
      attempted += 1;
      broadcastMessage({
        type: "BULK_UNFOLLOW_PROGRESS",
        phase: "dispatching",
        current: attempted,
        total: users.length,
        userId: item.userId,
        username: item.username
      });

      await sendUnfollowToContentScript(item);
      succeeded += 1;
      broadcastMessage({
        type: "UNFOLLOW_DONE",
        userId: item.userId,
        username: item.username
      });

      if (attempted < users.length) {
        broadcastMessage({
          type: "BULK_UNFOLLOW_PROGRESS",
          phase: "waiting",
          current: attempted,
          total: users.length,
          delayMs: BULK_UNFOLLOW_DELAY_MS,
          userId: item.userId,
          username: item.username
        });
        await sleep(BULK_UNFOLLOW_DELAY_MS);
      }
    }
  } catch (err) {
    error = err?.message || String(err);
    const item = users[attempted - 1];
    broadcastMessage({ type: "UNFOLLOW_ERROR", ...item, error });
  } finally {
    unfollowQueueRunning = false;
    unfollowQueueTotal = 0;
    broadcastMessage({
      type: "BULK_UNFOLLOW_FINISHED",
      total: users.length,
      attempted,
      succeeded,
      failed: attempted - succeeded,
      remaining: users.length - attempted,
      error
    });
  }
}

// Questa funzione viene eseguita nel mondo MAIN della scheda Instagram:
// deve essere autonoma, senza dipendenze dalle variabili del service worker.
// Legge il contesto del sito, senza invocare le sue funzioni di unfollow.
function readInstagramUnfollowContext(userId) {
  let step = "runtime Instagram";
  try {
    if (location.origin !== "https://www.instagram.com" || !/^[1-9]\d*$/.test(userId)) {
      return { ok: false, error: "Contesto Instagram non valido per l'unfollow." };
    }

    function getModule(name) {
      step = name;
      const module = window.require(name);
      return module?.default ?? module;
    }

    function requireValue(name, value) {
      step = name;
      if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
        throw new Error("Valore mancante");
      }
      return String(value);
    }

    const dtsg = getModule("DTSG");
    step = "DTSG.getToken";
    const token = requireValue("fb_dtsg", dtsg.getToken());
    const dtsgUtils = getModule("DTSGUtils");
    step = "DTSGUtils.getNumericValue";
    const jazoest = requireValue("jazoest", dtsgUtils.getNumericValue(token));

    const navModule = getModule("IGNavChain");
    step = "IGNavChain.getInstance";
    const navigation = navModule.getInstance();
    const navChain = requireValue("nav_chain", navigation?.getNavChainForSend());
    const containerUtils = getModule("PolarisContainerModuleUtils");
    step = "PolarisContainerModuleUtils.getContainerModule";
    const containerModule = requireValue("container_module", containerUtils.getContainerModule(navigation.last()?.pageID));

    // Lo stesso costruttore usato dal sito legge CSRF, claim, revisione,
    // app ID e sessione correnti. Non copiamo valori dalla registrazione HAR.
    const instajax = getModule("PolarisInstajax");
    step = "PolarisInstajax.getHeaders";
    const nativeHeaders = instajax.getHeaders("POST", `/api/v1/friendships/destroy/${userId}/`);
    const allowedHeaders = new Set([
      "x-csrftoken", "x-instagram-ajax", "x-ig-app-id", "x-asbd-id",
      "x-ig-www-claim", "x-web-session-id", "x-ig-max-touch-points",
      "x-web-device-id", "x-mid"
    ]);
    const headers = {};
    for (const [name, value] of Object.entries(nativeHeaders)) {
      const key = name.toLowerCase();
      if (allowedHeaders.has(key) && value != null) headers[key] = String(value);
    }
    for (const name of ["x-csrftoken", "x-instagram-ajax", "x-ig-app-id", "x-asbd-id", "x-ig-www-claim", "x-web-session-id"]) {
      requireValue(name, headers[name]);
    }

    return {
      ok: true,
      headers,
      body: { container_module: containerModule, nav_chain: navChain, user_id: userId, jazoest, fb_dtsg: token }
    };
  } catch {
    // Riportiamo il campo/modulo mancante, mai il contenuto dei token.
    return { ok: false, error: `Unfollow non inviato: impossibile leggere ${step} dalla pagina Instagram. Ricarica la pagina e riprova.` };
  }
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
  if (message.type === "GET_UNFOLLOW_CONTEXT") {
    // Il contesto torna solo al content script della stessa pagina che lo chiede.
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
        !sender.url?.startsWith("https://www.instagram.com/") ||
        (sender.origin && sender.origin !== "https://www.instagram.com") ||
        !/^[1-9]\d*$/.test(String(message.userId))) {
      sendResponse({ ok: false, error: "Richiesta di contesto unfollow non valida." });
      return;
    }
    const target = sender.documentId
      ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
      : { tabId: sender.tab.id, frameIds: [0] };
    chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: readInstagramUnfollowContext,
      args: [String(message.userId)]
    }).then(results => {
      const result = results.find(entry => entry.frameId === 0)?.result;
      sendResponse(result || { ok: false, error: "Contesto unfollow non disponibile. Ricarica la pagina Instagram." });
    }).catch(() => {
      sendResponse({ ok: false, error: "Impossibile leggere il contesto unfollow. Ricarica estensione e pagina Instagram." });
    });
    return true;
  }

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

  if (message.type === "UNFOLLOW_USER" || message.type === "START_BULK_UNFOLLOW") {
    if (unfollowQueueRunning) {
      sendResponse({
        accepted: false,
        running: true,
        total: unfollowQueueTotal,
        error: "C'è già una coda di unfollow in esecuzione."
      });
      return;
    }

    const requestedUsers = message.type === "UNFOLLOW_USER"
      ? [message]
      : (Array.isArray(message.users) ? message.users : []);
    const usersById = new Map();
    for (const user of requestedUsers) {
      if (user && /^[1-9]\d*$/.test(String(user.userId)) && typeof user.username === "string" && user.username) {
        usersById.set(String(user.userId), { userId: String(user.userId), username: user.username });
      }
    }
    const users = [...usersById.values()];
    if (users.length === 0) {
      sendResponse({ accepted: false, error: "Nessun utente valido da elaborare." });
      return;
    }

    processUnfollowQueue(users).catch(err => {
      console.warn("[Background] Errore coda unfollow:", err);
    });
    sendResponse({ accepted: true });
    return;
  }
});
