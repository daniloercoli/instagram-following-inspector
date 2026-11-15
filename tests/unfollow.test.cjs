const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const contentSource = read("contentScript.js");
const backgroundSource = read("background.js");
const tick = () => new Promise(resolve => setImmediate(resolve));
const successBody = '{"status":"ok","friendship_status":{"following":false}}';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function response(body = successBody, status = 200, contentType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    url: "https://www.instagram.com/api/v1/friendships/destroy/101/",
    redirected: false,
    text: async () => body
  };
}

function requestContext(userId, token = "fresh-dtsg-not-for-logs") {
  return {
    ok: true,
    headers: {
      "x-csrftoken": "fresh-csrf-not-for-logs",
      "x-instagram-ajax": "123456",
      "x-ig-app-id": "936619743392459",
      "x-asbd-id": "359341",
      "x-ig-www-claim": "fresh-claim-not-for-logs",
      "x-web-session-id": "session:tab:page",
      "x-ig-max-touch-points": "0"
    },
    body: {
      container_module: "profile",
      nav_chain: "Profile:profilePage:1:via_cold_start",
      user_id: userId,
      jazoest: "23456",
      fb_dtsg: token
    }
  };
}

function contentHarness(fetch, getContext = (message, callback) => callback(requestContext(message.userId))) {
  let listener;
  let timerId = 0;
  const timers = new Map();
  const logs = [];
  const context = vm.createContext({
    URLSearchParams,
    AbortController,
    document: { cookie: "csrftoken=test-secret-not-for-logs" },
    chrome: { runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      sendMessage(message, callback) {
        assert.equal(message.type, "GET_UNFOLLOW_CONTEXT", "Unfollow results must use the response channel, not duplicate broadcasts");
        getContext(message, callback);
      }
    } },
    fetch,
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    log: (...args) => logs.push(args)
  });
  vm.runInContext(contentSource, context);
  vm.runInContext("debugLog = log; logToStatusModal = log; mySleep = async () => {};", context);
  function invoke(message = { type: "UNFOLLOW_USER", userId: "101", username: "example" }) {
    const result = deferred();
    const responses = [];
    const returned = listener(message, {}, value => {
      responses.push(value);
      result.resolve(value);
    });
    assert.equal(returned, true, "The async message channel must stay open");
    return { result: result.promise, responses };
  }
  return { listener, invoke, logs, timers };
}

test("unfollow confirms only a validated response and logs the unchanged body", async () => {
  const body = '{\n  "status": "ok", "friendship_status": {"following": false}\n}';
  const h = contentHarness(async () => response(body));
  const call = h.invoke();
  assert.equal((await call.result).ok, true);
  assert.equal(call.responses.length, 1);
  assert.ok(h.logs.some(args => args[0] === `Unfollow risposta originale Instagram per @example:\n${body}`));
  assert.ok(!JSON.stringify(h.logs).includes("test-secret-not-for-logs"));
  for (const secret of ["fresh-csrf-not-for-logs", "fresh-dtsg-not-for-logs", "fresh-claim-not-for-logs", "session:tab:page"]) {
    assert.ok(!JSON.stringify(h.logs).includes(secret));
  }
  assert.equal(h.timers.size, 0);
});

test("unfollow sends the native form fields and headers, refreshing context on every attempt", async () => {
  const fetches = [];
  let reads = 0;
  const h = contentHarness(async (url, options) => {
    fetches.push({ url, options });
    return response();
  }, (message, callback) => callback(requestContext(message.userId, `rotated-${++reads}`)));
  assert.equal((await h.invoke().result).ok, true);
  assert.equal((await h.invoke().result).ok, true);
  assert.equal(reads, 2);
  for (let i = 0; i < fetches.length; i++) {
    const { url, options } = fetches[i];
    assert.equal(url, "https://www.instagram.com/api/v1/friendships/destroy/101/");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "include");
    assert.deepEqual(Object.fromEntries(options.body), requestContext("101", `rotated-${i + 1}`).body);
    for (const [name, value] of Object.entries(requestContext("101").headers)) {
      assert.equal(options.headers[name], value);
    }
    assert.equal(options.headers["x-requested-with"], "XMLHttpRequest");
  }
});

test("missing page context stops the unfollow before any HTTP request", async () => {
  const h = contentHarness(() => assert.fail("POST must not be sent"), (message, callback) => {
    callback({ ok: false, error: "Unfollow non inviato: impossibile leggere fb_dtsg dalla pagina Instagram." });
  });
  const result = await h.invoke().result;
  assert.equal(result.ok, false);
  assert.match(result.error, /fb_dtsg/);
  assert.equal(h.timers.size, 0);
});

test("page context timeout cannot dispatch a POST even if its response arrives later", async () => {
  let reply;
  const h = contentHarness(() => assert.fail("POST must not be sent"), (message, callback) => { reply = callback; });
  const call = h.invoke();
  await tick();
  [...h.timers.values()][0].fn();
  const result = await call.result;
  assert.equal(result.ok, false);
  assert.match(result.error, /timeout nella lettura/);
  reply(requestContext("101"));
  await tick();
  assert.equal(call.responses.length, 1);
});

test("invalidated extension context stops before POST and clears the timer", async () => {
  const h = contentHarness(() => assert.fail("POST must not be sent"), () => {
    throw new Error("Extension context invalidated");
  });
  const result = await h.invoke().result;
  assert.equal(result.ok, false);
  assert.match(result.error, /ricarica estensione e pagina Instagram/);
  assert.equal(h.timers.size, 0);
});

for (const [label, body, status] of [
  ["HTML with HTTP 200", "<!doctype html><title>Instagram</title>", 200],
  ["empty body", "", 200],
  ["empty object", "{}", 200],
  ["null JSON", "null", 200],
  ["API failure", '{"status":"fail","message":"feedback_required"}', 200],
  ["still following", '{"status":"ok","friendship_status":{"following":true}}', 200],
  ["missing friendship status", '{"status":"ok"}', 200],
  ["string false", '{"status":"ok","friendship_status":{"following":"false"}}', 200],
  ["HTTP failure despite success-shaped JSON", successBody, 429]
]) {
  test(`unfollow rejects ${label} and keeps the original response in the log`, async () => {
    const h = contentHarness(async () => response(body, status));
    const call = h.invoke();
    const result = await call.result;
    assert.equal(result.ok, false);
    assert.match(result.error, /Unfollow non confermato/);
    assert.equal(call.responses.length, 1);
    assert.ok(h.logs.some(args => args[0].endsWith(`\n${body || "(corpo vuoto)"}`)));
    assert.ok(!h.logs.some(args => args[0].startsWith("Unfollow confermato da Instagram")));
    assert.equal(h.timers.size, 0);
  });
}

test("unfollow waits for the response body and records redirects and content type", async () => {
  const body = deferred();
  const res = response();
  res.text = () => body.promise;
  res.url = "https://www.instagram.com/accounts/login/";
  res.redirected = true;
  res.headers.get = () => "text/html";
  const h = contentHarness(async () => res);
  const call = h.invoke();
  await tick();
  assert.equal(call.responses.length, 0);
  const metadata = h.logs.find(args => args[0].startsWith("Unfollow risposta HTTP"))[1];
  assert.equal(metadata.contentType, "text/html");
  assert.equal(metadata.url, res.url);
  assert.equal(metadata.redirected, true);
  body.resolve("<html>Login</html>");
  assert.equal((await call.result).ok, false);
});

test("unfollow timeout aborts the request and reports an unknown outcome once", async () => {
  const h = contentHarness((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  const call = h.invoke();
  await tick();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.ms, 15000);
  timer.fn();
  const result = await call.result;
  assert.equal(result.ok, false);
  assert.match(result.error, /Timeout.*esito non verificato/);
  assert.equal(call.responses.length, 1);
  assert.equal(h.timers.size, 0);
});

function queueHarness() {
  const fetches = [];
  const pauses = [];
  const broadcasts = [];
  let listener;
  const content = contentHarness((url, options) => {
    const job = { url, options, ...deferred() };
    fetches.push(job);
    return job.promise;
  }, (message, callback) => {
    assert.equal(listener(message, {
      tab: { id: 7 }, frameId: 0, documentId: "document-7",
      url: "https://www.instagram.com/example/", origin: "https://www.instagram.com"
    }, callback), true);
  });
  const chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      sendMessage(message, callback) {
        broadcasts.push(JSON.parse(JSON.stringify(message)));
        callback();
      }
    },
    scripting: {
      async executeScript(options) {
        assert.equal(options.world, "MAIN");
        assert.equal(options.target.tabId, 7);
        assert.equal(options.target.documentIds[0], "document-7");
        return [{ frameId: 0, result: requestContext(options.args[0]) }];
      }
    },
    tabs: {
      query(query, callback) { callback([{ id: 7 }]); },
      sendMessage(tabId, message, callback) {
        assert.equal(content.listener(message, {}, callback), true);
      }
    }
  };
  const context = vm.createContext({
    chrome,
    console,
    pause(ms) {
      const wait = { ms, ...deferred() };
      pauses.push(wait);
      return wait.promise;
    }
  });
  vm.runInContext(backgroundSource, context);
  vm.runInContext("sleep = pause;", context);
  function send(message) {
    let result;
    listener(message, {}, value => { result = value; });
    return result;
  }
  return { send, fetches, pauses, broadcasts, chrome };
}

const users = [
  { userId: "101", username: "first" },
  { userId: "202", username: "second" },
  { userId: "303", username: "third" }
];

test("queue waits for validation plus the pause, and rejects overlapping single and bulk requests", async () => {
  const h = queueHarness();
  assert.equal(h.send({ type: "START_BULK_UNFOLLOW", users: users.slice(0, 2) }).accepted, true);
  await tick();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.pauses.length, 0);
  assert.equal(h.broadcasts.filter(m => m.type === "UNFOLLOW_DONE").length, 0);
  assert.equal(h.broadcasts.filter(m => m.type === "BULK_UNFOLLOW_FINISHED").length, 0);
  for (const message of [
    { type: "UNFOLLOW_USER", ...users[2] },
    { type: "START_BULK_UNFOLLOW", users: [users[2]] }
  ]) {
    const result = h.send(message);
    assert.equal(result.accepted, false);
    assert.equal(result.running, true);
  }

  const firstBody = deferred();
  const firstResponse = response();
  firstResponse.text = () => firstBody.promise;
  h.fetches[0].resolve(firstResponse);
  await tick();
  assert.equal(h.pauses.length, 0, "HTTP headers alone must not advance the queue");
  firstBody.resolve(successBody);
  await tick();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.pauses[0].ms, 8000);
  assert.equal(h.broadcasts.filter(m => m.type === "UNFOLLOW_DONE").length, 1);
  assert.equal(h.send({ type: "UNFOLLOW_USER", ...users[2] }).accepted, false);

  h.pauses[0].resolve();
  await tick();
  assert.equal(h.fetches.length, 2);
  assert.ok(h.fetches[1].url.includes("/destroy/202/"));
  h.fetches[1].resolve(response());
  await tick();
  assert.deepEqual(h.broadcasts.at(-1), {
    type: "BULK_UNFOLLOW_FINISHED", total: 2, attempted: 2,
    succeeded: 2, failed: 0, remaining: 0, error: null
  });
});

test("queue stops at the first unconfirmed response and reports accurate totals", async () => {
  const h = queueHarness();
  h.send({ type: "START_BULK_UNFOLLOW", users });
  await tick();
  h.fetches[0].resolve(response());
  await tick();
  h.pauses[0].resolve();
  await tick();
  h.fetches[1].resolve(response("<html>Instagram</html>", 200, "text/html"));
  await tick();
  assert.equal(h.fetches.length, 2);
  assert.equal(h.pauses.length, 1);
  assert.equal(h.broadcasts.filter(m => m.type === "UNFOLLOW_DONE").length, 1);
  assert.equal(h.broadcasts.filter(m => m.type === "UNFOLLOW_ERROR").length, 1);
  const finish = h.broadcasts.at(-1);
  assert.equal(finish.succeeded, 1);
  assert.equal(finish.failed, 1);
  assert.equal(finish.remaining, 1);
  assert.match(finish.error, /non JSON/);

  assert.equal(h.send({ type: "UNFOLLOW_USER", ...users[2] }).accepted, true);
  await tick();
  h.fetches[2].resolve(response());
  await tick();
  assert.equal(h.broadcasts.at(-1).succeeded, 1);
});

test("queue treats a missing content-script response as failure", async () => {
  const h = queueHarness();
  h.chrome.tabs.sendMessage = (id, message, callback) => callback();
  h.send({ type: "START_BULK_UNFOLLOW", users });
  await tick();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.broadcasts.at(-1).failed, 1);
  assert.equal(h.broadcasts.at(-1).remaining, 2);
  assert.match(h.broadcasts.at(-1).error, /Nessuna conferma/);
});

test("queue stops after a transport error", async () => {
  const h = queueHarness();
  h.chrome.tabs.sendMessage = (id, message, callback) => {
    h.chrome.runtime.lastError = { message: "Tab closed" };
    callback();
    delete h.chrome.runtime.lastError;
  };
  h.send({ type: "START_BULK_UNFOLLOW", users });
  await tick();
  assert.equal(h.broadcasts.at(-1).succeeded, 0);
  assert.equal(h.broadcasts.at(-1).error, "Tab closed");
  assert.equal(h.broadcasts.at(-1).remaining, 2);
});

test("queue rejects empty input and dispatches each valid user only once", async () => {
  const h = queueHarness();
  assert.equal(h.send({ type: "START_BULK_UNFOLLOW", users: [] }).accepted, false);
  assert.equal(h.broadcasts.length, 0);
  h.send({ type: "START_BULK_UNFOLLOW", users: [users[0], users[0], { userId: "undefined", username: "bad" }] });
  await tick();
  h.fetches[0].resolve(response());
  await tick();
  assert.equal(h.fetches.length, 1);
  assert.equal(h.broadcasts.at(-1).total, 1);
  assert.equal(h.broadcasts.at(-1).succeeded, 1);
});
