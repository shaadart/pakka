// UI behaviour against the mocked backend (tests/mock-api.mjs). Runs at 1440 and 390 wide.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mockApi } from "./mock-api.mjs";

const SAMPLE = "Kal 11 baje slot milega?";
const isMobile = (page) => page.viewportSize().width < 1000;
const has = (bin) => { try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };

async function open(page, opts) {
  const api = await mockApi(page, opts);
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Online");
  return api;
}
async function ask(page, text) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("send-button").click();
}
const rig = (page) => page.getByRole("button", { name: /^Test rig/ });

test("a reply shows every contract field, and the input empties", async ({ page }) => {
  await open(page);
  await ask(page, "hello there");
  const slip = page.getByTestId("assistant-message");
  await expect(slip).toHaveCount(1);
  await expect(page.getByTestId("chat-input")).toHaveValue("");
  await expect(slip).toContainText("Reply to: hello there");
  await expect(slip.getByTestId("meta-source")).toHaveText("LIVE_INFERENCE");
  await expect(slip.getByTestId("meta-model")).toHaveText("gemini/test-model");
  await expect(slip.getByTestId("meta-latency")).toHaveText("812 ms");
  await expect(slip.getByTestId("meta-input-tokens")).toHaveText("36");
  await expect(slip.getByTestId("meta-output-tokens")).toHaveText("31");
  for (const id of ["meta-source", "meta-model", "meta-latency", "meta-input-tokens", "meta-output-tokens"]) {
    await expect(slip.getByTestId(id)).toBeVisible();
  }
});

test("Enter sends, Shift+Enter adds a line", async ({ page }) => {
  const api = await open(page);
  const box = page.getByTestId("chat-input");
  await box.fill("line one");
  await box.press("Shift+Enter");
  await box.pressSequentially("line two");
  await expect(box).toHaveValue("line one\nline two");
  await box.press("Enter");
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  expect(api.chats[0].body.message).toBe("line one\nline two");
});

test("every page load starts a new session; the old one is offered read-only", async ({ page }) => {
  const api = await open(page);
  await ask(page, "Mera naam Asha hai");
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  const first = api.chats[0].body.session_id;

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Online");
  await expect(page.getByTestId("assistant-message")).toHaveCount(0);
  await page.getByRole("button", { name: "Show the session from before you reloaded (2 messages)" }).click();
  await expect(page.locator(".slip").filter({ hasText: "Reply to: Mera naam Asha hai" })).toBeVisible();
  await expect(page.getByText(`Earlier session ${first}`)).toBeVisible();
  await expect(page.getByTestId("assistant-message")).toHaveCount(0); // past receipts carry no contract testids

  await ask(page, "Mera naam kya hai?");
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  expect(api.chats[1].body.session_id).not.toBe(first);
});

test("a cache hit says 0 billed and links to the receipt with the same key", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: SAMPLE }).click();
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  await rig(page).click();
  await page.getByRole("button", { name: "Same question, new session" }).click();
  const hit = page.getByTestId("assistant-message").nth(1);
  await expect(hit.getByTestId("meta-source")).toHaveText("LLM_CACHE");
  await expect(hit.locator(".stamp")).toHaveText("From cache");
  await expect(hit).toContainText("0 billed");
  await expect(hit.getByTestId("meta-input-tokens")).toHaveText("36");
  await expect(page.locator(".ledger footer")).toContainText("1 from cache · billed 0 in / 0 out tokens");

  const link = hit.getByRole("button", { name: "Same key as Receipt #0001, earlier session" });
  await link.click();
  await expect(page.locator(".flash .slip")).toContainText("Reply to: " + SAMPLE);
  await expect(page.getByTestId("assistant-message").first().getByRole("button", { name: "Same key as Receipt #0001, earlier session" })).toBeVisible();
});

test("the printed barcode scans as the printed cache key", async ({ page }, info) => {
  test.skip(!has("zbarimg"), "needs zbarimg");
  await open(page);
  await ask(page, "scan me");
  const slip = page.getByTestId("assistant-message");
  const printed = (await slip.locator(".hex span").first().innerText()).replace(/\s/g, "").toLowerCase();
  const shot = info.outputPath("barcode.png");
  await slip.locator(".code svg").screenshot({ path: shot, animations: "disabled" }); // finish the print animation
  const decoded = execFileSync("zbarimg", ["-q", "--raw", shot]).toString().trim();
  expect(decoded).toBe(printed);
  expect(printed).toMatch(/^[0-9a-f]{16}$/);
});

test("failure drill: failover receipt, then a VOID with Retry", async ({ page }) => {
  const api = await open(page);
  await rig(page).click();
  const key1 = page.getByRole("group", { name: "key_1 status" });
  await key1.getByRole("button", { name: "429" }).click();
  await expect(key1.getByRole("button", { name: "429" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("X-Simulate-Failure: key_1=429")).toBeVisible();
  await expect(rig(page)).toHaveText("Test rig · failures on");

  await ask(page, "failover please");
  const slip = page.getByTestId("assistant-message");
  await expect(slip).toContainText("429, skipped");
  await expect(slip.locator(".ln", { hasText: "Key" }).last()).toContainText("key_2");
  expect(api.chats[0].sim).toBe("key_1=429");

  await page.getByRole("group", { name: "key_2 status" }).getByRole("button", { name: "503" }).click();
  await page.getByRole("group", { name: "key_1 status" }).getByRole("button", { name: "503" }).click();
  await expect(page.getByText("X-Simulate-Failure: *=503")).toBeVisible();
  await ask(page, "everything is down");
  await expect(page.locator(".slip.isvoid")).toContainText("Every key failed");
  const bubble = page.locator(".user.unsaved");
  await expect(bubble).toContainText("Not saved");

  await page.getByRole("button", { name: "Reset all to ok" }).click();
  await expect(page.getByRole("button", { name: "Reset all to ok" })).toBeDisabled();
  await bubble.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".user.unsaved")).toHaveCount(0);
  await expect(page.getByTestId("assistant-message")).toHaveCount(2);
  expect(api.chats.at(-1)).toMatchObject({ body: { message: "everything is down" }, sim: null });
});

test("422: empty and too-long messages get readable errors; long text comes back", async ({ page }) => {
  await open(page);
  await page.getByTestId("send-button").click();
  await expect(page.getByRole("alert")).toContainText("A message needs 1 to 4000 characters");

  const long = "x".repeat(4001);
  await page.getByTestId("chat-input").fill(long);
  await expect(page.locator(".count")).toHaveText("4001 / 4000");
  await expect(page.locator(".count")).toHaveClass(/over/);
  await page.getByTestId("send-button").click();
  await expect(page.getByRole("alert").last()).toContainText("A message needs 1 to 4000 characters");
  await expect(page.getByTestId("chat-input")).toHaveValue(long);
  await expect(page.getByTestId("assistant-message")).toHaveCount(0);
});

test("the counter stays hidden until the message is near the limit", async ({ page }) => {
  await open(page);
  await page.getByTestId("chat-input").fill("short");
  await expect(page.locator(".count")).toHaveCount(0);
  await page.getByTestId("chat-input").fill("  " + "y".repeat(3501) + "  ");
  await expect(page.locator(".count")).toHaveText("3501 / 4000"); // trimmed, like the backend
});

test("Run checks asks before spending quota, and Esc closes it", async ({ page }) => {
  const api = await open(page);
  await rig(page).click();
  await page.getByRole("button", { name: "Run checks" }).click();
  const dialog = page.getByRole("dialog", { name: "Contract check" });
  await expect(dialog).toContainText("about five live model calls");
  await expect(dialog.getByRole("button", { name: "Start" })).toBeFocused();
  await expect(page.locator("header.top")).toHaveAttribute("inert", "");
  await page.waitForTimeout(300);
  expect(api.chats).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("header.top")).not.toHaveAttribute("inert", "");
});

test("mobile History drawer: focus moves in, Esc and the backdrop close it", async ({ page }) => {
  test.skip(!isMobile(page), "the drawer exists below 1000px");
  await open(page);
  const history = page.getByRole("button", { name: "History" });
  await history.click();
  await expect(page.locator(".ledger .close")).toBeFocused();
  await expect(page.locator("section.chat")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ledger")).not.toHaveClass(/open/);
  await expect(history).toBeFocused();

  await history.click();
  await page.locator(".scrim").click({ position: { x: 5, y: 400 } });
  await expect(page.locator(".ledger")).not.toHaveClass(/open/);
});

test("History: plain heading, Rows/JSON toggle shows its state", async ({ page }) => {
  await open(page);
  await ask(page, "hi");
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  if (isMobile(page)) await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  const json = page.getByRole("button", { name: "JSON" });
  await json.click();
  await expect(json).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ledger pre")).toContainText('"resolution_source": "LIVE_INFERENCE"');
  await page.getByRole("button", { name: "Rows" }).click();
  await expect(page.locator(".rows li")).toHaveCount(2);
  await expect(page.locator(".rows .meta")).toHaveText("Live · 36 in / 31 out · key_1");
});

test("screen readers hear only the reply, not the whole receipt", async ({ page }) => {
  await open(page);
  await ask(page, "announce me");
  await expect(page.locator(".sr-only[aria-live]")).toHaveText("Reply from the live model, 812 ms: Reply to: announce me");
  await expect(page.locator(".feed")).not.toHaveAttribute("aria-live", /.*/);
  await expect(page.locator(".code svg")).toHaveAttribute("aria-hidden", "true");
});

test("reading older messages is not interrupted; a pill offers the new reply", async ({ page }) => {
  const api = await open(page);
  for (let i = 1; i <= 5; i++) {
    await ask(page, `message ${i}`);
    await expect(page.getByTestId("assistant-message")).toHaveCount(i);
  }
  api.delayMs = 800;
  await ask(page, "slow one");
  const feed = page.locator(".feed");
  await feed.evaluate((el) => el.scrollTo(0, 0));
  await expect(page.getByTestId("assistant-message")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "New reply below" })).toBeVisible();
  expect(await feed.evaluate((el) => el.scrollTop)).toBeLessThan(50);
  await page.getByRole("button", { name: "New reply below" }).click();
  await expect.poll(() => feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(80);
});

test("the status sign re-checks the backend and reports when it goes down", async ({ page }) => {
  await page.clock.install();
  const api = await open(page);
  await expect(page.getByRole("status")).toHaveClass(/open/);
  api.healthUp = false;
  await page.clock.fastForward(30_000);
  await expect(page.getByRole("status")).toContainText("Waking the backend");
  // Each retry timer is set only after the previous fetch returns, so advance the clock in steps.
  await expect.poll(async () => {
    await page.clock.fastForward(2_000);
    return page.getByRole("status").innerText();
  }).toContain("Backend not answering");
  api.healthUp = true;
  await page.getByRole("status").getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toContainText("Online");
});

test("no sideways scroll at 320 px, and fonts come from this origin", async ({ page }) => {
  const external = [];
  page.on("request", (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) external.push(r.url()); });
  await page.setViewportSize({ width: 320, height: 700 });
  await open(page);
  await ask(page, "gemini/gemini-3.5-flash-lite " + "longword".repeat(12));
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  await rig(page).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("800 30px 'Big Shoulders Display'"); })).toBe(true);
  expect(external).toEqual([]);
});

test("mobile: the chat keeps most of the screen", async ({ page }) => {
  test.skip(!isMobile(page), "phone layout");
  await open(page);
  const feed = await page.locator(".feed").boundingBox();
  expect(feed.height / 844).toBeGreaterThan(0.6);
});

test("tap targets are at least 44 px on phones", async ({ page }) => {
  test.skip(!isMobile(page), "phone layout");
  await open(page);
  await ask(page, "hi");
  await expect(page.getByTestId("assistant-message")).toHaveCount(1);
  await rig(page).click();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, textarea")]
      .filter((el) => el.offsetParent && !el.closest("[inert]") && !el.closest(".ledger:not(.open)"))
      .map((el) => ({ t: el.textContent.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((b) => b.h < 43.9), // sub-pixel rounding from rem sizes
  );
  expect(small, JSON.stringify(small)).toEqual([]);
});

test("Copy reply puts the reply text on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await ask(page, "copy me");
  await page.getByRole("button", { name: "Copy reply" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Reply to: copy me");
  await expect(page.getByRole("button", { name: "Copy reply" })).toBeVisible(); // resets
});

test("spacing and type scale with the user's font size", async ({ page }) => {
  await open(page);
  const px = async () => (await page.locator(".top").boundingBox()).height;
  const before = await px();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await px()).toBeGreaterThan(before * 1.4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
});

test("the credit link is visible, and History runs to the bottom of the screen", async ({ page }) => {
  await open(page);
  const link = page.getByRole("link", { name: "See more of my work" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://madebyshaad.com");
  const vh = page.viewportSize().height;
  const credit = await page.locator(".credit").boundingBox();
  expect(credit.y + credit.height).toBeGreaterThan(vh - 1);
  if (!isMobile(page)) {
    const ledger = await page.locator(".ledger").boundingBox();
    expect(ledger.y + ledger.height).toBeGreaterThan(vh - 1);
  }
});
