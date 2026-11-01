const PAGE_SIZE = 100;
const MAX_PAGES = 1000; // max 1000 pagine per tipo
const INSTAGRAM_WEB_APP_ID = "936619743392459";
const PROFILE_REQUEST_DELAY_MS = [3000, 7000];
const LIST_REQUEST_DELAY_MS = [4000, 10000];
const UNFOLLOW_REQUEST_DELAY_MS = [6000, 12000];

let igStatusModal = null;
let igStatusLogEl = null;

function ensureStatusModal() {
  if (igStatusModal && igStatusLogEl) return;

  igStatusModal = document.createElement("div");
  igStatusModal.id = "ig-following-status-modal";

  Object.assign(igStatusModal.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    width: "320px",
    maxHeight: "50vh",
    background: "rgba(17, 24, 39, 0.96)",
    color: "#e5e7eb",
    borderRadius: "12px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: "12px",
    zIndex: "9999999",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "8px 10px",
    borderBottom: "1px solid rgba(55, 65, 81, 0.8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  });

  const title = document.createElement("div");
  title.textContent = "IG Following Tool";
  Object.assign(title.style, {
    fontSize: "12px",
    fontWeight: "600"
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    background: "transparent",
    border: "none",
    color: "#9ca3af",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "1"
  });
  closeBtn.addEventListener("click", () => {
    igStatusModal.remove();
    igStatusModal = null;
    igStatusLogEl = null;
  });

  header.appendChild(title);
  header.appendChild(closeBtn);

  igStatusLogEl = document.createElement("pre");
  igStatusLogEl.id = "ig-following-status-log";
  Object.assign(igStatusLogEl.style, {
    margin: "0",
    padding: "8px 10px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowY: "auto",
    flex: "1"
  });

  igStatusModal.appendChild(header);
  igStatusModal.appendChild(igStatusLogEl);
  document.body.appendChild(igStatusModal);
}

function logToStatusModal(message) {
  try {
    ensureStatusModal();
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}\n`;
    igStatusLogEl.textContent += line;
    igStatusLogEl.scrollTop = igStatusLogEl.scrollHeight;
  } catch (e) {
    console.error("Errore nel logToStatusModal", e);
  }
}

function debugLog(...args) {
  console.log("[FollowingFetcher] ", ...args);

  const msg = args
    .map(a => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  logToStatusModal(msg);
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop().split(";").shift());
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_FOLLOWING") {
    const forcedUsername = message.username || null;

    logToStatusModal("Avvio analisi per il profilo " + (forcedUsername || "(da URL)") + "…");

    startFullProcess(forcedUsername).catch(err => {
      debugLog("Errore:", err?.message || String(err));
      chrome.runtime.sendMessage({
        type: "FOLLOWING_ERROR",
        error: err?.message || String(err)
      });
    });
  }

  if (message.type === "UNFOLLOW_USER") {
    const { userId, username } = message;
    logToStatusModal(`Unfollow @${username} (${userId}) in corso...`);
    unfollowUser(userId, username).catch(err => {
      debugLog("Errore unfollow", username, ":", err?.message || String(err));
      logToStatusModal(`Errore unfollow @${username}: ${err?.message || err}`);
    });
  }

  if (message.type === "SHOW_ERROR") {
    if (message.message) {
      alert(message.message);
      logToStatusModal("Errore: " + message.message);
    }
  }
});

async function unfollowUser(userId, username) {
  const csrftoken = getCookie("csrftoken");
  const appId = "936619743392459";

  const headers = {
    "accept": "*/*",
    "x-requested-with": "XMLHttpRequest",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
  };

  if (csrftoken) {
    headers["x-csrftoken"] = csrftoken;
  }
  if (appId) {
    headers["x-ig-app-id"] = appId;
  }

  const url = `https://www.instagram.com/api/v1/friendships/destroy/${userId}/`;

  await mySleep(...UNFOLLOW_REQUEST_DELAY_MS);

  debugLog("Unfollow fetch:", url, headers);

  const body = new URLSearchParams();
  body.set("user_id", String(userId));

  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers,
      body
    });

    debugLog("Unfollow status", res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugLog("Unfollow non OK per", username, ":", res.status, text);
      chrome.runtime.sendMessage({
        type: "UNFOLLOW_ERROR",
        userId,
        username,
        error: `HTTP ${res.status}`
      });
      throw new Error(`Unfollow non OK: ${res.status}`);
    }

    const json = await res.json().catch(() => ({}));
    debugLog("Unfollow OK per", username, json);
    logToStatusModal(`Unfollow completato per @${username}.`);

    chrome.runtime.sendMessage({
      type: "UNFOLLOW_DONE",
      userId,
      username
    });
  } catch (err) {
    debugLog("Errore fetch unfollow per", username, ":", err?.message || String(err));
    chrome.runtime.sendMessage({
      type: "UNFOLLOW_ERROR",
      userId,
      username,
      error: err?.message || String(err)
    });
    throw err;
  }
}

function extractUsernameFromLocation() {
  const url = location.href;
  const m = url.match(/^https:\/\/www\.instagram\.com\/([^\/?#]+)\/?/i);
  if (!m) return null;

  const firstSegment = m[1].toLowerCase();
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

  return m[1];
}

async function startFullProcess(forcedUsername) {
  debugLog("Inizio processo completo (following + followers)…");

  let username = forcedUsername;
  if (!username) {
    username = extractUsernameFromLocation();
  }

  if (!username) {
    throw new Error("Impossibile determinare lo username dalla URL. Sei su una pagina profilo?");
  }

  debugLog("Profilo rilevato:", username);

  await mySleep(...PROFILE_REQUEST_DELAY_MS);
  const userId = await getUserIdFromUsername(username);
  if (!userId) {
    throw new Error("Impossibile ottenere userId per " + username);
  }
  debugLog("userId:", userId);

  debugLog("Scarico FOLLOWING...");
  const followingResult = await fetchFollowing(userId);
  debugLog("FOLLOWING completato:", followingResult.totalUsers);

  debugLog("Scarico FOLLOWERS...");
  const followersResult = await fetchFollowers(userId);
  debugLog("FOLLOWERS completato:", followersResult.totalUsers);

  const notFollowingBack = computeNotFollowingBack(
    followingResult.users,
    followersResult.users
  );

  debugLog("Non mi seguono back:", notFollowingBack.length);
  logToStatusModal("Analisi completata! Sto aprendo la pagina risultati…");

  const result = {
    username,
    userId,
    following: {
      total: followingResult.totalUsers,
      pagesFetched: followingResult.pagesFetched,
      users: followingResult.users
    },
    followers: {
      total: followersResult.totalUsers,
      pagesFetched: followersResult.pagesFetched,
      users: followersResult.users
    },
    notFollowingBack
  };

  chrome.runtime.sendMessage({
    type: "FOLLOWING_RESULTS",
    data: result
  });
}

function normalizeUserId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}

function findUserIdInPageData(data, username) {
  const expectedUsername = username.toLowerCase();
  const pending = [data];

  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;

    // Match the username and ID on the same object: the page also contains
    // the logged-in viewer, suggested accounts, and authors of other posts.
    if (typeof value.username === "string" && value.username.toLowerCase() === expectedUsername) {
      const userId = normalizeUserId(value.pk) || normalizeUserId(value.id);
      if (userId) return userId;
    }

    for (const child of Object.values(value)) {
      pending.push(child);
    }
  }

  return null;
}

function getUserIdFromPage(username) {
  // Instagram embeds PolarisViewer and preloaded profile data in JSON script
  // elements. Reading their text also works in the content script's isolated world.
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      continue;
    }

    const userId = findUserIdInPageData(data, username);
    if (userId) return userId;
  }

  return null;
}

async function getUserIdFromUsername(username) {
  const pageUserId = getUserIdFromPage(username);
  if (pageUserId) {
    debugLog(`userId trovato nei dati della pagina per @${username}: ${pageUserId}`);
    return pageUserId;
  }

  debugLog("userId non presente nei dati della pagina; provo web_profile_info...");

  const csrftoken = getCookie("csrftoken");
  const appId = INSTAGRAM_WEB_APP_ID;

  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;

  const headers = {
    "accept": "*/*",
    "x-requested-with": "XMLHttpRequest"
  };

  if (appId) {
    headers["x-ig-app-id"] = appId;
  }
  if (csrftoken) {
    headers["x-csrftoken"] = csrftoken;
  }

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers
  });

  debugLog("web_profile_info status:", res.status);

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Instagram limita il recupero del profilo (HTTP 429). Riprova più tardi.");
    }
    throw new Error(`web_profile_info non OK: ${res.status}`);
  }

  const json = await res.json();
  const user = json?.data?.user;
  if (typeof user?.username === "string" && user.username.toLowerCase() !== username.toLowerCase()) {
    throw new Error("Instagram ha restituito un profilo diverso da quello richiesto.");
  }
  return normalizeUserId(user?.pk) || normalizeUserId(user?.id);
}

function mySleep(minMs = 2000, maxMs = 15000) {
  const min = Number(minMs);
  const max = Number(maxMs);

  const safeMin = Number.isFinite(min) ? min : 2500;
  const safeMax = Number.isFinite(max) ? max : 4500;

  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);

  const delay = Math.floor(Math.random() * (high - low + 1)) + low;

  debugLog(`Attendo ${delay} ms prima della prossima richiesta...`);

  return new Promise(resolve => setTimeout(resolve, delay));
}

async function fetchFollowing(userId) {
  const allUsers = [];
  const rawResponses = [];
  let hasMore = true;
  let nextMaxId = undefined;
  let pagesFetched = 0;
  let globalIndex = 0;

  while (hasMore && pagesFetched < MAX_PAGES) {
    const params = new URLSearchParams();
    params.set("count", String(PAGE_SIZE));
    if (nextMaxId) {
      params.set("max_id", nextMaxId);
    }

    const apiUrl = `https://www.instagram.com/api/v1/friendships/${userId}/following/?` + params.toString();

    const csrftoken = getCookie("csrftoken");
    const appId = INSTAGRAM_WEB_APP_ID;

    const headers = {
      "accept": "*/*",
      "x-requested-with": "XMLHttpRequest"
    };

    if (csrftoken) {
      headers["x-csrftoken"] = csrftoken;
    }
    if (appId) {
      headers["x-ig-app-id"] = appId;
    }

    const res = await fetch(apiUrl, {
      method: "GET",
      credentials: "include",
      headers
    });

    debugLog("FOLLOWING status:", res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[FollowingFetcher] FOLLOWING non OK:", res.status, res.statusText, text);
      throw new Error(`FOLLOWING risposta non OK: ${res.status}`);
    }

    const data = await res.json();
    rawResponses.push(data);

    const users = data.users || [];
    users.forEach(u => {
      const enriched = { ...u, _order: globalIndex++ };
      allUsers.push(enriched);
    });

    pagesFetched++;

    hasMore = Boolean(data.has_more);
    nextMaxId = data.next_max_id;

    debugLog(
      `FOLLOWING pagina ${pagesFetched} - users: ${users.length}, has_more: ${hasMore}, next_max_id: ${nextMaxId}`
    );

    if (!hasMore) {
      debugLog("FOLLOWING: has_more=false, stop (lista completa).");
      break;
    }

    await mySleep(...LIST_REQUEST_DELAY_MS);
  }

  return {
    pagesFetched,
    totalUsers: allUsers.length,
    users: allUsers,
    rawResponses
  };
}

async function fetchFollowers(userId) {
  const allUsers = [];
  const rawResponses = [];
  let hasMore = true;
  let nextMaxId = undefined;
  let pagesFetched = 0;

  while (hasMore && pagesFetched < MAX_PAGES) {
    const params = new URLSearchParams();
    params.set("count", String(PAGE_SIZE));
    params.set("search_surface", "follow_list_page");
    if (nextMaxId) {
      params.set("max_id", nextMaxId);
    }

    const apiUrl = `https://www.instagram.com/api/v1/friendships/${userId}/followers/?` + params.toString();

    const csrftoken = getCookie("csrftoken");
    const appId = INSTAGRAM_WEB_APP_ID;

    const headers = {
      "accept": "*/*",
      "x-requested-with": "XMLHttpRequest"
    };

    if (csrftoken) {
      headers["x-csrftoken"] = csrftoken;
    }
    if (appId) {
      headers["x-ig-app-id"] = appId;
    }

    const res = await fetch(apiUrl, {
      method: "GET",
      credentials: "include",
      headers
    });

    debugLog("FOLLOWERS status:", res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugLog("FOLLOWERS non OK:", res.status, res.statusText, text);
      throw new Error(`FOLLOWERS risposta non OK: ${res.status}`);
    }

    const data = await res.json();
    rawResponses.push(data);

    const users = data.users || [];
    allUsers.push(...users);

    pagesFetched++;

    hasMore = Boolean(data.has_more);
    nextMaxId = data.next_max_id;

    debugLog(
      `FOLLOWERS pagina ${pagesFetched} - users: ${users.length}, has_more: ${hasMore}, next_max_id: ${nextMaxId}`
    );

    if (!hasMore) {
      debugLog("FOLLOWERS: has_more=false, stop.");
      break;
    }

    await mySleep(...LIST_REQUEST_DELAY_MS);
  }

  return {
    pagesFetched,
    totalUsers: allUsers.length,
    users: allUsers,
    rawResponses
  };
}

function computeNotFollowingBack(followingUsers, followersUsers) {
  const followerIds = new Set(
    (followersUsers || []).map(u => String(u.pk))
  );

  const notBack = (followingUsers || []).filter(u => {
    const id = String(u.pk);
    return !followerIds.has(id);
  });

  notBack.sort((a, b) => {
    const oa = typeof a._order === "number" ? a._order : Number.MAX_SAFE_INTEGER;
    const ob = typeof b._order === "number" ? b._order : Number.MAX_SAFE_INTEGER;
    return oa - ob;
  });

  return notBack;
}
