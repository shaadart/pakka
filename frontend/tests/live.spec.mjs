// The UI against the real stack (`make up`): real backend, real SQLite, real cache.
// Cost: at most one live model call (the first sample question, if the cache is cold). The rest is
// cache hits and simulated failures, which never reach a model.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

const SAMPLE = "Kal 11 baje slot milega?";
const has = (bin) => { try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };

test.describe.configure({ mode: "serial" });

test("a real reply, then a real cache hit that links back to it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one pass is enough against the real model");
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Online", { timeout: 30_000 });

  await page.getByRole("button", { name: SAMPLE }).click();
  const first = page.getByTestId("assistant-message").first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  await expect(first.getByTestId("meta-source")).toHaveText(/^(LIVE_INFERENCE|LLM_CACHE)$/);
  await expect(first.getByTestId("meta-model")).not.toBeEmpty();
  await expect(first.getByTestId("meta-latency")).toHaveText(/^\d+ ms$/);
  await expect(first.getByTestId("meta-input-tokens")).toHaveText(/^\d+$/);
  await expect(first.getByTestId("meta-output-tokens")).toHaveText(/^\d+$/);

  await page.getByRole("button", { name: /^Test rig/ }).click();
  await page.getByRole("button", { name: "Same question, new session" }).click();
  const hit = page.getByTestId("assistant-message").nth(1);
  await expect(hit.getByTestId("meta-source")).toHaveText("LLM_CACHE", { timeout: 30_000 });
  await expect(hit).toContainText("0 billed");
  await expect(hit.getByRole("button", { name: "Same key as Receipt #0001, earlier session" })).toBeVisible();
  await expect(page.locator(".ledger footer")).toContainText("1 from cache · billed 0 in / 0 out tokens");

  if (has("zbarimg")) {
    const printed = (await hit.locator(".hex span").first().innerText()).replace(/\s/g, "");
    const shot = info.outputPath("live-barcode.png");
    await hit.locator(".code svg").screenshot({ path: shot, animations: "disabled" });
    expect(execFileSync("zbarimg", ["-q", "--raw", shot]).toString().trim()).toBe(printed);
  }
});

test("every key down: a VOID, nothing saved, History still 404, Retry works once keys recover", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Online", { timeout: 30_000 });
  await page.getByRole("button", { name: /^Test rig/ }).click();
  for (const group of await page.getByRole("group", { name: /^key_\d+ status$/ }).all()) {
    await group.getByRole("button", { name: "503" }).click();
  }
  await expect(page.getByText("X-Simulate-Failure: *=503")).toBeVisible();

  // A fresh question would cost a model call on Retry, so use the cached sample: Retry is then a cache hit.
  await page.getByTestId("chat-input").fill(SAMPLE);
  await page.getByTestId("send-button").click();
  await expect(page.locator(".slip.isvoid")).toContainText("Every key failed", { timeout: 30_000 });
  await expect(page.locator(".user.unsaved")).toContainText("Not saved");
  await expect(page.locator(".ledger footer .endpoint")).toContainText("· 404");

  await page.getByRole("button", { name: "Reset all to ok" }).click();
  await page.locator(".user.unsaved").getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("assistant-message")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator(".user.unsaved")).toHaveCount(0);
  await expect(page.locator(".ledger footer .endpoint")).toContainText("· 200");
});

test("reload starts a new session and offers the old one read-only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Online", { timeout: 30_000 });
  await page.getByRole("button", { name: SAMPLE }).click(); // cached by the first test
  await expect(page.getByTestId("assistant-message")).toHaveCount(1, { timeout: 60_000 });
  const before = await page.locator(".ledger .call").textContent();

  await page.reload();
  await expect(page.getByRole("status")).toContainText("Online", { timeout: 30_000 });
  await expect(page.getByTestId("assistant-message")).toHaveCount(0);
  expect(await page.locator(".ledger .call").textContent()).not.toBe(before);
  await page.getByRole("button", { name: /Show the session from before you reloaded \(2 messages\)/ }).click();
  await expect(page.locator(".slip")).toHaveCount(1);
  await expect(page.getByTestId("assistant-message")).toHaveCount(0);
});
