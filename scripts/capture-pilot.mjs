import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { signAccessJwt, SYNTHETIC_AUDIENCE, SYNTHETIC_ISSUER } from "../lib/access-auth.ts";

const base = process.env.PILOT_ORIGIN || "http://127.0.0.1:5173";
const privateJwk = JSON.parse(process.env.PILOT_SYNTHETIC_PRIVATE_JWK);
const now = Math.floor(Date.now() / 1000);
const token = await signAccessJwt(privateJwk, {
  sub: "synthetic-admin",
  email: "admin@synthetic.winter-watch.invalid",
  aud: SYNTHETIC_AUDIENCE,
  iss: SYNTHETIC_ISSUER,
  iat: now,
  nbf: now,
  exp: now + 3600,
  groups: ["winter-watch-admins"],
});
const outDir = process.env.SCREENSHOT_DIR || "/tmp/ww-evidence/screenshots";
mkdirSync(outDir, { recursive: true });

const chrome = spawn("google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--remote-debugging-port=9222",
  "--user-data-dir=/tmp/ww-chrome-profile",
  "about:blank",
], { stdio: "ignore" });

async function cdp() {
  const list = await fetch("http://127.0.0.1:9222/json/version").then((response) => response.json());
  const socket = new WebSocket(list.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  function send(method, params = {}, sessionId) {
    const messageId = ++id;
    socket.send(JSON.stringify({ id: messageId, method, params, sessionId }));
    return new Promise((resolve) => pending.set(messageId, resolve));
  }
  const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
  const page = new WebSocket(target.webSocketDebuggerUrl);
  const pagePending = new Map();
  let pageId = 0;
  page.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pagePending.has(message.id)) {
      pagePending.get(message.id)(message);
      pagePending.delete(message.id);
    }
  });
  await new Promise((resolve) => page.addEventListener("open", resolve));
  function call(method, params = {}) {
    const messageId = ++pageId;
    page.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve) => pagePending.set(messageId, resolve));
  }
  await call("Network.enable");
  await call("Page.enable");
  await call("Network.setCookie", { name: "CF_Authorization", value: token, url: base, httpOnly: true });
  async function shoot(width, height, name, scroll) {
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await call("Page.navigate", { url: base });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    if (scroll) {
      await call("Runtime.evaluate", { expression: `document.querySelector('${scroll}')?.scrollIntoView({block:'start'})` });
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const shot = await call("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.result.data, "base64"));
    console.log(`wrote ${outDir}/${name}.png`);
  }
  await shoot(1280, 900, "pilot_overview_1280");
  await shoot(390, 844, "pilot_overview_390");
  await shoot(1280, 900, "pilot_queue_1280", ".queue-panel");
  await shoot(390, 844, "pilot_queue_390", ".queue-panel");
  page.close();
  socket.close();
  void send;
}
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await fetch("http://127.0.0.1:9222/json/version");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  await cdp();
} finally {
  chrome.kill();
}
