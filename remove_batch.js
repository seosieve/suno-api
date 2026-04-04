#!/usr/bin/env node
/**
 * SUNO 업로드 오디오 삭제 스크립트
 * 사용법: node remove_batch.js <곡이름> [--headless]
 * 예: node remove_batch.js "01_우린 랜더스"
 */

const { chromium } = require("rebrowser-playwright-core");
require("dotenv").config();

const SUNO_URL = "https://suno.com/create";

async function main() {
  const args = process.argv.filter(a => !a.startsWith("--"));
  const songName = args[2];
  if (!songName) {
    console.log('사용법: node remove_batch.js <곡이름> [--headless]');
    console.log('예: node remove_batch.js "01_우린 랜더스"');
    process.exit(1);
  }

  const headless = process.argv.includes("--headless");
  console.log(`\n🗑️  SUNO 삭제: ${songName}`);

  const browser = await chromium.launch({ headless, slowMo: 500 });
  const context = await browser.newContext();

  const cookieStr = process.env.SUNO_COOKIE;
  if (!cookieStr) {
    console.log("❌ SUNO_COOKIE가 .env에 설정되어 있지 않습니다");
    await browser.close();
    process.exit(1);
  }

  const cookies = cookieStr.split(";").map(c => {
    const [name, ...rest] = c.trim().split("=");
    return { name: name.trim(), value: rest.join("=").trim(), domain: ".suno.com", path: "/" };
  }).filter(c => c.name && c.value);

  await context.addCookies(cookies);
  const page = await context.newPage();

  console.log("🔐 SUNO 접속 중...");
  await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);

  try {
    const acceptBtn = page.locator('button:has-text("Accept All Cookies")').first();
    if (await acceptBtn.isVisible({ timeout: 3000 })) {
      await acceptBtn.click();
      console.log("🍪 쿠키 동의 완료");
      await page.waitForTimeout(2000);
    }
  } catch (_) {}

  const url = page.url();
  if (url.includes("accounts") || url.includes("sign-in")) {
    console.log("❌ 로그인 실패");
    await browser.close();
    process.exit(1);
  }
  console.log("✅ 로그인 성공");

  // Uploads 탭 클릭
  const uploadsTab = page.locator('button:has-text("Uploads")').first();
  if (await uploadsTab.isVisible({ timeout: 5000 })) {
    await uploadsTab.click();
    console.log("📂 Uploads 탭 선택");
    await page.waitForTimeout(2000);
  }

  // 곡 찾기
  const songEl = page.locator(`text=${songName}`).first();
  if (!(await songEl.isVisible({ timeout: 5000 }))) {
    console.log(`❌ "${songName}" 을 찾을 수 없습니다`);
    await page.screenshot({ path: "/tmp/suno_remove_notfound.png" });
    await browser.close();
    process.exit(1);
  }
  console.log(`🔍 "${songName}" 발견`);

  // 곡에서 우클릭으로 컨텍스트 메뉴 열기
  await songEl.click({ button: "right" });
  await page.waitForTimeout(1000);

  // Move to Trash 클릭
  const trashBtn = page.locator('text=Move to Trash').first();
  if (await trashBtn.isVisible({ timeout: 3000 })) {
    await trashBtn.click();
    console.log(`🗑️  "${songName}" 삭제 완료!`);
    await page.waitForTimeout(2000);
  } else {
    console.log("⚠️  Move to Trash를 찾을 수 없습니다");
    await page.screenshot({ path: "/tmp/suno_remove_no_trash.png" });
  }

  await browser.close();
}

main().catch(console.error);
