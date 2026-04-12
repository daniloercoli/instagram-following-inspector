document.addEventListener("DOMContentLoaded", () => {
  const usernameEl = document.getElementById("username");
  const userIdEl = document.getElementById("userId");
  const followingTotalEl = document.getElementById("following-total");
  const followingPagesEl = document.getElementById("following-pages");
  const followersTotalEl = document.getElementById("followers-total");
  const followersPagesEl = document.getElementById("followers-pages");
  const nonBackTotalEl = document.getElementById("nonback-total");
  const nonBackListEl = document.getElementById("nonback-list");
  const rawJsonEl = document.getElementById("raw-json");
  const bulkActionsEl = document.getElementById("bulk-actions");
  const bulkStatusEl = document.getElementById("bulk-status");

  const buttonStateByUserId = new Map();
  let bulkButton = null;
  let bulkRunning = false;

  function setBulkStatus(text, isError = false) {
    if (!bulkStatusEl) return;
    bulkStatusEl.textContent = text || "";
    bulkStatusEl.style.color = isError ? "#b91c1c" : "#374151";
  }

  function setButtonState(button, state) {
    if (!button) return;

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

  function setBulkButtonState(state, count = 0) {
    if (!bulkButton) return;

    if (state === "idle") {
      bulkButton.disabled = false;
      bulkButton.textContent = count > 0 ? `Unfollow tutti (${count})` : "Unfollow tutti";
      bulkButton.style.background = "#dc2626";
      bulkButton.style.color = "#ffffff";
      bulkButton.style.border = "1px solid #b91c1c";
      bulkButton.style.cursor = "pointer";
      bulkRunning = false;
    } else if (state === "busy") {
      bulkButton.disabled = true;
      bulkButton.textContent = "Unfollow automatico in corso...";
      bulkButton.style.background = "#e5e7eb";
      bulkButton.style.color = "#6b7280";
      bulkButton.style.border = "1px solid #9ca3af";
      bulkButton.style.cursor = "default";
      bulkRunning = true;
    } else if (state === "done") {
      bulkButton.disabled = true;
      bulkButton.textContent = "Operazione completata";
      bulkButton.style.background = "#dcfce7";
      bulkButton.style.color = "#166534";
      bulkButton.style.border = "1px solid #86efac";
      bulkButton.style.cursor = "default";
      bulkRunning = false;
    }
  }

  function createBulkControls(notBack) {
    if (!bulkActionsEl) return;
    bulkActionsEl.innerHTML = "";

    bulkButton = document.createElement("button");
    bulkButton.id = "bulk-unfollow-btn";
    bulkButton.style.width = "100%";
    bulkButton.style.fontSize = "18px";
    bulkButton.style.fontWeight = "700";
    bulkButton.style.padding = "14px 16px";
    bulkButton.style.borderRadius = "12px";
    bulkButton.style.marginBottom = "12px";

    setBulkButtonState("idle", notBack.length);

    bulkButton.addEventListener("click", () => {
      if (bulkRunning || notBack.length === 0) return;

      const users = notBack.map(u => ({
        userId: String(u.pk),
        username: u.username
      }));

      setBulkButtonState("busy");
      setBulkStatus(`Coda avviata: ${users.length} unfollow da eseguire con pausa tra una richiesta e l'altra.`);

      chrome.runtime.sendMessage({
        type: "START_BULK_UNFOLLOW",
        users
      });
    });

    bulkActionsEl.appendChild(bulkButton);
  }

  chrome.storage.local.get("followingResults", (result) => {
    const data = result.followingResults;

    if (!data) {
      document.body.innerHTML = "<p>Nessun risultato trovato. Prova a cliccare l'icona dell'estensione mentre sei sulla pagina del profilo Instagram.</p>";
      return;
    }

    usernameEl.textContent = data.username;
    userIdEl.textContent = data.userId;
    followingTotalEl.textContent = data.following?.total ?? 0;
    followingPagesEl.textContent = data.following?.pagesFetched ?? 0;
    followersTotalEl.textContent = data.followers?.total ?? 0;
    followersPagesEl.textContent = data.followers?.pagesFetched ?? 0;

    const notBack = data.notFollowingBack || [];
    nonBackTotalEl.textContent = notBack.length;

    createBulkControls(notBack);

    nonBackListEl.innerHTML = "";
    if (notBack.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Non ci sono utenti che non ti seguono back (nei dati scaricati).";
      nonBackListEl.appendChild(li);
      setBulkStatus("Nessun unfollow da fare.");
      if (bulkButton) {
        bulkButton.disabled = true;
      }
    } else {
      setBulkStatus("Premi il pulsante grande per l'unfollow automatico oppure usa i bottoni singoli.");

      notBack.forEach((u, idx) => {
        const li = document.createElement("li");

        const link = document.createElement("a");
        link.href = `https://www.instagram.com/${u.username}/`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = u.username;
        li.appendChild(link);

        if (u.full_name) {
          const fullSpan = document.createElement("span");
          fullSpan.textContent = ` – ${u.full_name}`;
          li.appendChild(fullSpan);
        }

        const meta = document.createElement("span");
        meta.className = "meta";
        if (typeof u._order === "number") {
          meta.textContent = `• seguito come #${u._order + 1}`;
        } else {
          meta.textContent = "• ordine di follow sconosciuto";
        }
        li.appendChild(meta);

        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = idx === 0 ? "più recente" : "recenti";
        li.appendChild(tag);

        const btn = document.createElement("button");
        btn.textContent = "Unfollow";
        btn.dataset.userId = String(u.pk);
        btn.style.marginLeft = "8px";
        btn.style.fontSize = "11px";
        btn.style.padding = "2px 6px";
        btn.style.borderRadius = "6px";

        setButtonState(btn, "idle");
        buttonStateByUserId.set(String(u.pk), "idle");

        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          setButtonState(btn, "busy");
          buttonStateByUserId.set(String(u.pk), "busy");
          setBulkStatus(`Invio unfollow singolo per @${u.username}...`);

          chrome.runtime.sendMessage({
            type: "UNFOLLOW_USER",
            userId: String(u.pk),
            username: u.username
          });
        });

        li.appendChild(btn);
        nonBackListEl.appendChild(li);
      });
    }

    rawJsonEl.textContent = JSON.stringify(data, null, 2);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "BULK_UNFOLLOW_STARTED") {
      setBulkButtonState("busy");
      setBulkStatus(`Unfollow automatico avviato: ${message.total || 0} utenti in coda.`);
      return;
    }

    if (message.type === "BULK_UNFOLLOW_ALREADY_RUNNING") {
      setBulkButtonState("busy");
      setBulkStatus("C'è già una coda di unfollow in esecuzione.", true);
      return;
    }

    if (message.type === "BULK_UNFOLLOW_PROGRESS") {
      if (message.userId) {
        const btn = document.querySelector(`button[data-user-id="${String(message.userId)}"]`);
        if (btn && message.phase === "dispatching") {
          setButtonState(btn, "busy");
          buttonStateByUserId.set(String(message.userId), "busy");
        }
      }

      if (message.phase === "dispatching") {
        setBulkStatus(`(${message.current}/${message.total}) Unfollow in corso per @${message.username}...`);
      } else if (message.phase === "waiting") {
        const seconds = Math.round((message.delayMs || 0) / 1000);
        setBulkStatus(`(${message.current}/${message.total}) Pausa di ${seconds}s prima del prossimo unfollow.`);
      }
      return;
    }

    if (message.type === "BULK_UNFOLLOW_FINISHED") {
      setBulkButtonState("done");
      setBulkStatus(
        message.error
          ? `Coda terminata con errore finale: ${message.error}`
          : `Coda completata. Operazioni concluse: ${message.total || 0}.`,
        Boolean(message.error)
      );
      return;
    }

    if (message.type === "UNFOLLOW_DONE" || message.type === "UNFOLLOW_ERROR") {
      const userId = String(message.userId);
      const btn = document.querySelector(`button[data-user-id="${userId}"]`);
      if (!btn) return;

      if (message.type === "UNFOLLOW_DONE") {
        setButtonState(btn, "done");
        buttonStateByUserId.set(userId, "done");
      } else {
        setButtonState(btn, "idle");
        buttonStateByUserId.set(userId, "idle");
        setBulkStatus(`Errore durante l'unfollow di @${message.username || ""}: ${message.error || "errore sconosciuto"}`, true);
      }
    }
  });
});