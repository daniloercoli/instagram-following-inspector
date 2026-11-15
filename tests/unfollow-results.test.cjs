const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function resultsHarness() {
  let onReady;
  let onMessage;
  let accept = { accepted: true };
  const requests = [];
  const ids = new Map();
  const elements = [];
  function element() {
    const el = {
      style: {}, dataset: {}, children: [], disabled: false, textContent: "",
      appendChild(child) { this.children.push(child); },
      addEventListener(event, listener) { this[event] = listener; }
    };
    elements.push(el);
    return el;
  }
  const document = {
    addEventListener(event, listener) { onReady = listener; },
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, element());
      return ids.get(id);
    },
    createElement: element,
    body: element()
  };
  const chrome = {
    storage: { local: { get(key, callback) { callback({ followingResults: {
      username: "example", userId: "999",
      notFollowingBack: [
        { pk: "101", username: "first" },
        { pk: "202", username: "second" }
      ]
    } }); } } },
    runtime: {
      onMessage: { addListener(listener) { onMessage = listener; } },
      sendMessage(message, callback) {
        requests.push(JSON.parse(JSON.stringify(message)));
        callback(accept);
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "results.js"), "utf8"), { document, chrome });
  onReady();
  return {
    requests,
    emit: message => onMessage(message, {}, () => {}),
    status: ids.get("bulk-status"),
    bulk: elements.find(el => el.id === "bulk-unfollow-btn"),
    button: id => elements.find(el => el.dataset.userId === id),
    rejectWith(value) { accept = value; }
  };
}

test("results lock all controls during a single unfollow and exclude confirmed users from bulk", () => {
  const h = resultsHarness();
  h.button("101").click();
  assert.equal(h.requests.length, 1);
  assert.equal(h.bulk.disabled, true);
  assert.equal(h.button("202").disabled, true);
  h.button("202").click();
  assert.equal(h.requests.length, 1);

  h.emit({ type: "UNFOLLOW_DONE", userId: "101" });
  h.emit({ type: "BULK_UNFOLLOW_FINISHED", total: 1, succeeded: 1, failed: 0, remaining: 0 });
  assert.equal(h.button("101").textContent, "Unfollowed");
  assert.equal(h.button("101").disabled, true);
  assert.equal(h.button("202").disabled, false);
  assert.equal(h.bulk.textContent, "Unfollow tutti (1)");
  assert.match(h.status.textContent, /confermati: 1\/1/);
  h.bulk.click();
  assert.deepEqual(h.requests[1].users, [{ userId: "202", username: "second" }]);
});

test("results show an interrupted queue instead of green completion after a failure", () => {
  const h = resultsHarness();
  h.bulk.click();
  h.emit({ type: "BULK_UNFOLLOW_PROGRESS", phase: "dispatching", userId: "101", username: "first", current: 1, total: 2 });
  h.emit({ type: "UNFOLLOW_ERROR", userId: "101", username: "first", error: "non JSON" });
  assert.equal(h.button("101").disabled, true, "Controls stay locked until the queue stops");
  h.emit({ type: "BULK_UNFOLLOW_FINISHED", total: 2, succeeded: 0, failed: 1, remaining: 1, error: "non JSON" });
  assert.equal(h.bulk.disabled, false);
  assert.equal(h.bulk.textContent, "Unfollow tutti (2)");
  assert.equal(h.button("101").textContent, "Unfollow");
  assert.equal(h.button("101").disabled, false);
  assert.equal(h.button("202").disabled, false);
  assert.match(h.status.textContent, /0 confermati, 1 non confermati, 1 non eseguiti/);
  assert.equal(h.status.style.color, "#b91c1c");
});

test("results restore a rejected single request and respect a queue active in another tab", () => {
  const h = resultsHarness();
  h.rejectWith({ accepted: false, error: "Nessun utente valido" });
  h.button("101").click();
  assert.equal(h.button("101").textContent, "Unfollow");
  assert.equal(h.button("101").disabled, false);
  assert.equal(h.bulk.disabled, false);
  assert.match(h.status.textContent, /Nessun utente valido/);

  h.rejectWith({ accepted: false, running: true, error: "Coda già attiva" });
  h.button("101").click();
  assert.equal(h.button("101").textContent, "Unfollow");
  assert.equal(h.button("101").disabled, true);
  assert.equal(h.bulk.disabled, true);
  assert.match(h.status.textContent, /Coda già attiva/);
});
