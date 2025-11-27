document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get("followingResults", (result) => {
    const data = result.followingResults;

    if (!data) {
      document.body.innerHTML = "<p>Nessun risultato trovato. Prova a cliccare l'icona dell'estensione mentre sei sulla pagina dei following.</p>";
      return;
    }

    const usernameEl = document.getElementById("username");
    const userIdEl = document.getElementById("userId");
    const followingTotalEl = document.getElementById("following-total");
    const followingPagesEl = document.getElementById("following-pages");
    const followersTotalEl = document.getElementById("followers-total");
    const followersPagesEl = document.getElementById("followers-pages");
    const nonBackTotalEl = document.getElementById("nonback-total");
    const nonBackListEl = document.getElementById("nonback-list");
    const rawJsonEl = document.getElementById("raw-json");

    usernameEl.textContent = data.username;
    userIdEl.textContent = data.userId;

    followingTotalEl.textContent = data.following?.total ?? 0;
    followingPagesEl.textContent = data.following?.pagesFetched ?? 0;
    followersTotalEl.textContent = data.followers?.total ?? 0;
    followersPagesEl.textContent = data.followers?.pagesFetched ?? 0;

    const notBack = data.notFollowingBack || [];
    nonBackTotalEl.textContent = notBack.length;

    nonBackListEl.innerHTML = "";
    if (notBack.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Non ci sono utenti che non ti seguono back (nei dati scaricati).";
      nonBackListEl.appendChild(li);
    } else {
      notBack.forEach((u, idx) => {
        const li = document.createElement("li");
        const fullName = u.full_name ? ` – ${u.full_name}` : "";
        const orderInfo = typeof u._order === "number" ? ` (#${u._order + 1})` : "";

        li.textContent = `${u.username}${fullName}${orderInfo}`;

        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = idx === 0 ? "più recente" : "recenti";
        li.appendChild(tag);

        nonBackListEl.appendChild(li);
      });
    }

    rawJsonEl.textContent = JSON.stringify(data, null, 2);
  });
});
