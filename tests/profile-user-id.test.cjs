const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "contentScript.js"), "utf8");

function createHarness(scripts = [], respond) {
  const requests = [];
  const logs = [];
  const context = vm.createContext({
    document: {
      cookie: "",
      querySelectorAll(selector) {
        assert.equal(selector, 'script[type="application/json"]');
        return scripts.map(textContent => ({ textContent }));
      }
    },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      assert.ok(respond, "No network request should be made when the page contains a matching ID");
      return respond(url, options);
    },
    recordLog: (...args) => logs.push(args.join(" "))
  });
  vm.runInContext(source, context);
  vm.runInContext("debugLog = recordLog;", context);
  return { context, requests, logs };
}

function bootstrap(user) {
  return JSON.stringify({
    require: [["ScheduledServerJS", "handle", null, [{
      __bbox: { define: [["PolarisViewer", [], { data: user }, 123]] }
    }]]]
  });
}

test("reads the matching viewer ID from nested bootstrap JSON without a request", async () => {
  const h = createHarness([bootstrap({ username: "example.user", id: "12345678901" })]);
  assert.equal(await h.context.getUserIdFromUsername("EXAMPLE.USER"), "12345678901");
  assert.equal(h.requests.length, 0);
  assert.ok(h.logs.some(log => log.includes("userId trovato nei dati della pagina")));
});

test("finds the visited profile without confusing it with the logged-in viewer", async () => {
  const h = createHarness([
    bootstrap({ username: "signed_in_user", id: "111" }),
    JSON.stringify({ data: { user: { username: "visited_user", pk: "222" } } })
  ]);
  assert.equal(await h.context.getUserIdFromUsername("visited_user"), "222");
  assert.equal(h.requests.length, 0);
});

test("skips malformed JSON and invalid IDs before finding a valid match", async () => {
  const h = createHarness([
    "not JSON",
    bootstrap({ username: "example", id: "opaque-id" }),
    bootstrap({ username: "example", pk: 0 }),
    bootstrap({ username: "example", id: 9007199254740992 }),
    bootstrap({ username: "example", id: 123 })
  ]);
  assert.equal(await h.context.getUserIdFromUsername("example"), "123");
  assert.equal(h.requests.length, 0);
});

test("never combines a username with an unrelated nested ID", () => {
  const h = createHarness([JSON.stringify({ username: "example", other: { id: "123" } })]);
  assert.equal(h.context.getUserIdFromPage("example"), null);
});

test("falls back to the existing API when the page only contains another user", async () => {
  const h = createHarness([bootstrap({ username: "someone_else", id: "111" })], () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { user: { username: "example.user", id: "222" } } })
  }));
  assert.equal(await h.context.getUserIdFromUsername("example.user"), "222");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "https://www.instagram.com/api/v1/users/web_profile_info/?username=example.user");
  assert.equal(h.requests[0].options.credentials, "include");
  assert.equal(h.requests[0].options.headers["x-ig-app-id"], "936619743392459");
});

test("reports a fallback HTTP 429 without dumping its HTML or retrying", async () => {
  const h = createHarness([], () => ({
    ok: false,
    status: 429,
    text() { assert.fail("The HTML error page must not be read or logged"); }
  }));
  await assert.rejects(h.context.getUserIdFromUsername("example"), /HTTP 429.*Riprova più tardi/);
  assert.equal(h.requests.length, 1);
});

test("rejects an API response for a different profile", async () => {
  const h = createHarness([], () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { user: { username: "someone_else", id: "111" } } })
  }));
  await assert.rejects(h.context.getUserIdFromUsername("example"), /profilo diverso/);
});

test("does not accept a malformed profile response as an ID", async () => {
  const h = createHarness([], () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "fail" })
  }));
  assert.equal(await h.context.getUserIdFromUsername("example"), null);
});
