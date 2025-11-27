const PAGE_SIZE = 100;
const MAX_PAGES = 1000; // max 1000 pagine per tipo

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop().split(";").shift());
  }
  return null;
}


// Ascolta i messaggi dal background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_FOLLOWING") {
    startFullProcess().catch(err => {
      console.error("[FollowingFetcher] Errore:", err);
      chrome.runtime.sendMessage({
        type: "FOLLOWING_ERROR",
        error: err?.message || String(err)
      });
    });
  }

  if (message.type === "SHOW_ERROR") {
    if (message.message) {
      alert(message.message);
    }
  }
});

/**
 * Processo completo:
 * - username -> userId
 * - fetch following + followers
 * - match: chi seguo ma non mi segue
 * - invio risultato al background
 */
async function startFullProcess() {
  console.log("[FollowingFetcher] Inizio processo completo (following + followers)...");

  const url = location.href;
  const match = url.match(/^https:\/\/www\.instagram\.com\/([^/]+)\/following\/?/i);
  if (!match) {
    throw new Error("Non sembra una pagina /<username>/following/");
  }
  const username = match[1];
  console.log("[FollowingFetcher] Username:", username);

  const userId = await getUserIdFromUsername(username);
  if (!userId) {
    throw new Error("Impossibile ottenere userId per " + username);
  }
  console.log("[FollowingFetcher] userId:", userId);

  console.log("[FollowingFetcher] Scarico FOLLOWING...");
  const followingResult = await fetchFollowing(userId);
  console.log("[FollowingFetcher] FOLLOWING completato:", followingResult.totalUsers);

  console.log("[FollowingFetcher] Scarico FOLLOWERS...");
  const followersResult = await fetchFollowers(userId);
  console.log("[FollowingFetcher] FOLLOWERS completato:", followersResult.totalUsers);

  // Match: chi seguo ma non mi segue
  const notFollowingBack = computeNotFollowingBack(followingResult.users, followersResult.users);

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

  console.log("[FollowingFetcher] Non mi seguono back:", notFollowingBack.length);

  chrome.runtime.sendMessage({
    type: "FOLLOWING_RESULTS",
    data: result
  });
}

/**
 * Ottiene l'userId numerico partendo dallo username usando l'endpoint web_profile_info.
 */
async function getUserIdFromUsername(username) {
  const csrftoken = getCookie("csrftoken");
  const appId = "936619743392459"; // app id web di Instagram (lo vedi anche nelle richieste in Network)

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

  console.log("[FollowingFetcher] Chiamo web_profile_info:", url, headers);

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers
  });

  console.log("[FollowingFetcher] web_profile_info status:", res.status);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[FollowingFetcher] web_profile_info non OK:", res.status, res.statusText, text);
    throw new Error(`web_profile_info non OK: ${res.status}`);
  }

  const json = await res.json();
  console.log("[FollowingFetcher] web_profile_info risposta:", json);

  // Struttura tipica: { data: { user: { id: "2610846455", ... } } }
  const userId = json?.data?.user?.id;
  return userId || null;
}


/**
 * Scarica il FOLLOWING con paginazione.
 * Aggiungiamo un campo _order per rappresentare la "data" (ordine) del follow:
 *  - 0 = più recente, 1 = leggermente più vecchio, ecc.
 */
async function fetchFollowing(userId) {
  const allUsers = [];
  const rawResponses = [];
  let hasMore = true;
  let nextMaxId = undefined;
  let pagesFetched = 0;
  let globalIndex = 0;

  while (hasMore && pagesFetched < MAX_PAGES) {
    const params = new URLSearchParams();
    params.set("count", String(PAGE_SIZE));  // ora 100
    if (nextMaxId) {
      params.set("max_id", nextMaxId);
    }

    const apiUrl = `https://www.instagram.com/api/v1/friendships/${userId}/following/?` + params.toString();

    const csrftoken = getCookie("csrftoken");
    const appId = "936619743392459";

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

    console.log(`[FollowingFetcher] FOLLOWING pagina ${pagesFetched + 1}:`, apiUrl, headers);

    const res = await fetch(apiUrl, {
      method: "GET",
      credentials: "include",
      headers
    });

    console.log("[FollowingFetcher] FOLLOWING status:", res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[FollowingFetcher] FOLLOWING non OK:", res.status, res.statusText, text);
      throw new Error(`FOLLOWING risposta non OK: ${res.status}`);
    }

    const data = await res.json();
    rawResponses.push(data);

    const users = data.users || [];
    users.forEach(u => {
      // _order ci serve per l’ordinamento “più recente”
      const enriched = { ...u, _order: globalIndex++ };
      allUsers.push(enriched);
    });

    pagesFetched++;

    hasMore = Boolean(data.has_more);
    nextMaxId = data.next_max_id;

    console.log(
      `[FollowingFetcher] FOLLOWING pagina ${pagesFetched} - users: ${users.length}, has_more: ${hasMore}, next_max_id: ${nextMaxId}`
    );

    if (!hasMore) {
      console.log("[FollowingFetcher] FOLLOWING: has_more=false, stop (lista completa).");
      break;
    }
  }

  return {
    pagesFetched,
    totalUsers: allUsers.length,
    users: allUsers,
    rawResponses
  };
}

/**
 * Scarica i FOLLOWERS con paginazione.
 */
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

    // Anche qui usiamo solo getCookie per prendere il csrftoken
    const csrftoken = getCookie("csrftoken");
    const appId = "936619743392459";

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

    console.log(`[FollowingFetcher] FOLLOWERS pagina ${pagesFetched + 1}:`, apiUrl, headers);

    const res = await fetch(apiUrl, {
      method: "GET",
      credentials: "include",
      headers
    });

    console.log("[FollowingFetcher] FOLLOWERS status:", res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[FollowingFetcher] FOLLOWERS non OK:", res.status, res.statusText, text);
      throw new Error(`FOLLOWERS risposta non OK: ${res.status}`);
    }

    const data = await res.json();
    rawResponses.push(data);

    const users = data.users || [];
    allUsers.push(...users);

    pagesFetched++;

    hasMore = Boolean(data.has_more);
    nextMaxId = data.next_max_id;

    console.log(
      `[FollowingFetcher] FOLLOWERS pagina ${pagesFetched} - users: ${users.length}, has_more: ${hasMore}, next_max_id: ${nextMaxId}`
    );

    if (!hasMore) {
      console.log("[FollowingFetcher] FOLLOWERS: has_more=false, stop.");
      break;
    }
  }

  return {
    pagesFetched,
    totalUsers: allUsers.length,
    users: allUsers,
    rawResponses
  };
}

/**
 * Calcola gli utenti che io seguo (following) ma che non mi seguono (followers).
 * - Usa pk (id numerico) per matchare.
 * - Ordina per _order crescente (cioè: più recente prima).
 */
function computeNotFollowingBack(followingUsers, followersUsers) {
  const followerIds = new Set(
    (followersUsers || []).map(u => String(u.pk))
  );

  const notBack = (followingUsers || []).filter(u => {
    const id = String(u.pk);
    return !followerIds.has(id);
  });

  // Ordina per _order (più piccolo = più recente, in base all'ordine di Instagram)
  notBack.sort((a, b) => {
    const oa = typeof a._order === "number" ? a._order : Number.MAX_SAFE_INTEGER;
    const ob = typeof b._order === "number" ? b._order : Number.MAX_SAFE_INTEGER;
    return oa - ob;
  });

  return notBack;
}
