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

        // link cliccabile al profilo
        const link = document.createElement("a");
        link.href = `https://www.instagram.com/${u.username}/`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = u.username;
        li.appendChild(link);

        // full name, se presente
        if (u.full_name) {
          const fullSpan = document.createElement("span");
          fullSpan.textContent = ` – ${u.full_name}`;
          li.appendChild(fullSpan);
        }

        // info "quando": usiamo l'ordine di follow (0 = più recente)
        const meta = document.createElement("span");
        meta.className = "meta";

        if (typeof u._order === "number") {
          // _order 0 = più recente, poi 1, 2, ...
          const pos = u._order + 1;
          meta.textContent = `• seguito come #${pos}`;
        } else {
          meta.textContent = "• ordine di follow sconosciuto";
        }
        li.appendChild(meta);

        // tag "più recente" sul primo della lista
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
