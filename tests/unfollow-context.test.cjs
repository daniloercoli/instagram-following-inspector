const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backgroundSource = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

function backgroundHarness(executeScript = async () => []) {
  let listener;
  const context = vm.createContext({
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      scripting: { executeScript }
    }
  });
  vm.runInContext(backgroundSource, context);
  // La serializzazione simula executeScript: nessuna closure del background
  // e nessuna dipendenza disponibile solo nel mondo isolato dell'estensione.
  const source = vm.runInContext("readInstagramUnfollowContext.toString()", context);
  return { listener, source };
}

function pageHarness() {
  const state = {
    token: "token-one",
    navChain: "Profile:profilePage:1:via_cold_start",
    pageId: "profilePage",
    headers: {
      "X-CSRFToken": "csrf-one",
      "X-Instagram-AJAX": "revision-one",
      "X-IG-App-ID": "app-one",
      "X-ASBD-ID": "asbd-one",
      "X-IG-WWW-Claim": "claim-one",
      "X-Web-Session-ID": "session-one",
      "X-IG-Max-Touch-Points": "0"
    }
  };
  const modules = {
    DTSG: { getToken: () => state.token },
    DTSGUtils: { getNumericValue: token => "2" + [...token].reduce((sum, char) => sum + char.charCodeAt(0), 0) },
    IGNavChain: { default: { getInstance: () => ({
      getNavChainForSend: () => state.navChain,
      last: () => ({ pageID: state.pageId })
    }) } },
    PolarisContainerModuleUtils: { getContainerModule: pageId => {
      assert.equal(pageId, state.pageId);
      return pageId === "profilePage" ? "profile" : "self_profile";
    } },
    PolarisInstajax: { getHeaders: (method, url) => {
      assert.equal(method, "POST");
      assert.equal(url, "/api/v1/friendships/destroy/101/");
      return state.headers;
    } }
  };
  const context = vm.createContext({
    location: { origin: "https://www.instagram.com" },
    window: { require(name) {
      if (!modules[name]) throw new Error("module unavailable with secret diagnostic content");
      return modules[name];
    } },
    fetch() { assert.fail("Context extraction must not perform network requests"); }
  });
  const { source } = backgroundHarness();
  const read = () => JSON.parse(JSON.stringify(vm.runInContext(`(${source})("101")`, context)));
  return { state, modules, context, read };
}

test("page context uses current native modules, native header builder, and token checksum", () => {
  const h = pageHarness();
  h.state.headers["Authorization"] = "must-not-be-forwarded";
  const first = h.read();
  assert.equal(first.ok, true);
  assert.deepEqual(first.body, {
    container_module: "profile", nav_chain: h.state.navChain,
    user_id: "101", jazoest: "2912", fb_dtsg: "token-one"
  });
  assert.equal(first.headers["x-instagram-ajax"], "revision-one");
  assert.equal(first.headers.authorization, undefined);
  assert.equal(first.headers["x-ig-max-touch-points"], "0");

  h.state.token = "token-two";
  h.state.pageId = "selfProfilePage";
  h.state.navChain = "SelfProfile:selfProfilePage:2:tap";
  h.state.headers["X-IG-WWW-Claim"] = "claim-two";
  h.state.headers["X-Web-Session-ID"] = "session-two";
  const second = h.read();
  assert.equal(second.ok, true);
  assert.equal(second.body.fb_dtsg, "token-two");
  assert.notEqual(second.body.jazoest, first.body.jazoest);
  assert.equal(second.body.container_module, "self_profile");
  assert.equal(second.body.nav_chain, h.state.navChain);
  assert.equal(second.headers["x-ig-www-claim"], "claim-two");
  assert.equal(second.headers["x-web-session-id"], "session-two");
});

for (const [name, mutate] of [
  ["fb_dtsg", h => { h.state.token = null; }],
  ["nav_chain", h => { h.state.navChain = ""; }],
  ["x-csrftoken", h => { delete h.state.headers["X-CSRFToken"]; }],
  ["PolarisInstajax", h => { delete h.modules.PolarisInstajax; }]
]) {
  test(`page context reports missing ${name} without exposing session data`, () => {
    const h = pageHarness();
    mutate(h);
    const result = h.read();
    assert.equal(result.ok, false);
    assert.ok(result.error.includes(name));
    assert.ok(!JSON.stringify(result).includes("token-one"));
    assert.ok(!JSON.stringify(result).includes("csrf-one"));
    assert.ok(!JSON.stringify(result).includes("secret diagnostic"));
    assert.equal(result.body, undefined);
  });
}

test("page context rejects navigation away from Instagram", () => {
  const h = pageHarness();
  h.context.location.origin = "https://example.org";
  assert.equal(h.read().ok, false);
});

const validSender = {
  tab: { id: 7 }, frameId: 0, documentId: "document-7",
  url: "https://www.instagram.com/example/", origin: "https://www.instagram.com"
};

test("background reads the requesting document in MAIN and returns context only through its reply", async () => {
  const page = pageHarness();
  const h = backgroundHarness(async options => {
    assert.deepEqual(JSON.parse(JSON.stringify(options.target)), { tabId: 7, documentIds: ["document-7"] });
    assert.equal(options.world, "MAIN");
    const result = vm.runInContext(`(${options.func.toString()})("${options.args[0]}")`, page.context);
    return [{ frameId: 0, result }];
  });
  const response = await new Promise(resolve => {
    assert.equal(h.listener({ type: "GET_UNFOLLOW_CONTEXT", userId: 101 }, validSender, resolve), true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.body.fb_dtsg, "token-one");
});

test("background rejects context requests from extension pages, other origins, and subframes", () => {
  const h = backgroundHarness(() => assert.fail("Invalid sender must not inject code"));
  for (const sender of [
    {},
    { ...validSender, frameId: 3 },
    { ...validSender, url: "https://www.instagram.com.evil.test/" },
    { ...validSender, origin: "https://example.org" },
    { ...validSender, url: "chrome-extension://example/results.html" }
  ]) {
    let reply;
    h.listener({ type: "GET_UNFOLLOW_CONTEXT", userId: "101" }, sender, value => { reply = value; });
    assert.equal(reply.ok, false);
  }
  let reply;
  h.listener({ type: "GET_UNFOLLOW_CONTEXT", userId: "101/path" }, validSender, value => { reply = value; });
  assert.equal(reply.ok, false);
});

test("background returns a clear failure if the target document has disappeared", async () => {
  const h = backgroundHarness(async () => { throw new Error("No document with id document-7"); });
  const reply = await new Promise(resolve => {
    h.listener({ type: "GET_UNFOLLOW_CONTEXT", userId: "101" }, validSender, resolve);
  });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /Ricarica estensione e pagina Instagram/);
});
