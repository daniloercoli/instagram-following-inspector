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

        // Bottone Unfollow
        const btn = document.createElement("button");
        btn.textContent = "Unfollow";
        btn.dataset.userId = String(u.pk); // ci serve per identificarlo dopo
        btn.style.marginLeft = "8px";
        btn.style.fontSize = "11px";
        btn.style.padding = "2px 6px";
        btn.style.borderRadius = "6px";
        btn.style.border = "1px solid #ef4444";
        btn.style.background = "#fee2e2";
        btn.style.color = "#b91c1c";
        btn.style.cursor = "pointer";

        // helper per settare lo stato grafico
        function setButtonState(button, state) {
          if (state === "idle") {
            button.disabled = false;
            button.textContent = "Unfollow";
            button.style.border = "1px solid #ef4444";
            button.style.background = "#fee2e2";
            button.style.color = "#b91c1c";
            button.style.cursor = "pointer";
          } else if (state === "busy") {
            button.disabled = true;
            button.textContent = "Unfollowing...";
            button.style.border = "1px solid #9ca3af";
            button.style.background = "#e5e7eb";
            button.style.color = "#6b7280";
            button.style.cursor = "default";
          } else if (state === "done") {
            button.disabled = true;
            button.textContent = "Unfollowed";
            button.style.border = "1px solid #9ca3af";
            button.style.background = "#e5e7eb";
            button.style.color = "#6b7280";
            button.style.cursor = "default";
          }
        }

        // stato iniziale
        setButtonState(btn, "idle");

        btn.addEventListener("click", () => {
          if (btn.disabled) return; // doppio click extra-sicuro

          const confirmMsg = `Vuoi davvero fare unfollow a @${u.username}?`;
          if (!confirm(confirmMsg)) return;

          setButtonState(btn, "busy");

          chrome.runtime.sendMessage({
            type: "UNFOLLOW_USER",
            userId: u.pk,
            username: u.username
          });
        });

        li.appendChild(btn);

        nonBackListEl.appendChild(li);
      })  ;
    }

    rawJsonEl.textContent = JSON.stringify(data, null, 2);
  });


  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "UNFOLLOW_DONE" || message.type === "UNFOLLOW_ERROR") {
      const userId = String(message.userId);
      const btn = document.querySelector(`button[data-user-id="${userId}"]`);
      if (!btn) return;

      if (message.type === "UNFOLLOW_DONE") {
        // stato "OK"
        btn.disabled = true;
        btn.textContent = "Unfollowed";
        btn.style.border = "1px solid #9ca3af";
        btn.style.background = "#e5e7eb";
        btn.style.color = "#6b7280";
        btn.style.cursor = "default";
      } else {
        // errore: torna cliccabile e rosso
        btn.disabled = false;
        btn.textContent = "Unfollow";
        btn.style.border = "1px solid #ef4444";
        btn.style.background = "#fee2e2";
        btn.style.color = "#b91c1c";
        btn.style.cursor = "pointer";

        if (message.error) {
          alert(`Errore durante l'unfollow di @${message.username || ""}: ${message.error}`);
        }
      }
    }
  });


});

