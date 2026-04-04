#!/usr/bin/env node
/**
 * SUNO 오디오 일괄 업로드 스크립트
 * 사용법: node upload_batch.js <폴더경로>
 * 예: node upload_batch.js ~/Downloads/SSG_원곡_MR_slow
 */

const { chromium } = require("rebrowser-playwright-core");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const SUNO_URL = "https://suno.com/create";

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.log("사용법: node upload_batch.js <폴더경로>");
    console.log('예: node upload_batch.js ~/Downloads/SSG_원곡_MR_slow');
    process.exit(1);
  }

  const absDir = path.resolve(dir.replace("~", process.env.HOME));
  if (!fs.existsSync(absDir)) {
    console.log(`❌ 폴더 없음: ${absDir}`);
    process.exit(1);
  }

  // MP3/WAV/FLAC 파일 수집
  const files = fs.readdirSync(absDir)
    .filter(f => /\.(mp3|wav|flac|m4a)$/i.test(f))
    .sort()
    .map(f => path.join(absDir, f));

  if (files.length === 0) {
    console.log("❌ 오디오 파일 없음");
    process.exit(1);
  }

  // --limit N 옵션: 업로드할 파일 수 제한
  // --limit N: 업로드할 파일 수 제한, --skip N: 앞에서 N개 건너뛰기
  const limitIdx = process.argv.indexOf("--limit");
  const skipIdx = process.argv.indexOf("--skip");
  const skip = skipIdx !== -1 ? parseInt(process.argv[skipIdx + 1]) : 0;
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : files.length;
  files.splice(0, skip);
  files.splice(limit);

  console.log(`\n🎵 SUNO 일괄 업로드`);
  console.log(`📁 폴더: ${absDir}`);
  console.log(`📊 ${files.length}곡 발견\n`);
  files.forEach((f, i) => console.log(`  ${i + 1}. ${path.basename(f)}`));

  // 브라우저 실행
  console.log("\n🌐 브라우저 시작...");
  const browser = await chromium.launch({
    headless: process.argv.includes("--headless"),
    slowMo: 500,
  });

  const context = await browser.newContext();

  // 쿠키 설정
  const cookieStr = process.env.SUNO_COOKIE;
  if (!cookieStr) {
    console.log("❌ SUNO_COOKIE가 .env에 설정되어 있지 않습니다");
    await browser.close();
    process.exit(1);
  }

  const cookies = cookieStr.split(";").map(c => {
    const [name, ...rest] = c.trim().split("=");
    return {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain: ".suno.com",
      path: "/",
    };
  }).filter(c => c.name && c.value);

  await context.addCookies(cookies);

  const page = await context.newPage();

  // SUNO 접속
  console.log("\n🔐 SUNO 접속 중...");
  await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);

  // 쿠키 동의 팝업 처리
  try {
    const acceptBtn = page.locator('button:has-text("Accept All Cookies")').first();
    if (await acceptBtn.isVisible({ timeout: 3000 })) {
      await acceptBtn.click();
      console.log("🍪 쿠키 동의 완료");
      await page.waitForTimeout(2000);
    }
  } catch (_) {}

  // 로그인 확인
  const url = page.url();
  if (url.includes("accounts") || url.includes("sign-in")) {
    console.log("❌ 로그인 실패 — 쿠키가 만료되었을 수 있습니다");
    console.log("   .env의 SUNO_COOKIE를 갱신해주세요");
    await browser.close();
    process.exit(1);
  }

  console.log("✅ 로그인 성공\n");

  // 파일별 업로드
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = path.basename(file);
    console.log(`📤 [${i + 1}/${files.length}] ${name} 업로드 중...`);

    try {
      // 1) Advanced 탭 클릭
      const advancedTab = page.locator('button:has-text("Advanced"), [role="tab"]:has-text("Advanced")').first();
      if (await advancedTab.isVisible({ timeout: 5000 })) {
        await advancedTab.click();
        console.log("  🔧 Advanced 탭 선택");
        await page.waitForTimeout(1500);
      } else {
        console.log("  ⚠️  Advanced 탭을 찾을 수 없습니다. 스크린샷 저장...");
        await page.screenshot({ path: `/tmp/suno_upload_${i}.png` });
        continue;
      }

      // 2) + Audio 버튼 클릭 → 드롭다운 메뉴 열기
      const audioBtn = page.locator('button:has-text("Audio"), button:has-text("+ Audio")').first();
      if (await audioBtn.isVisible({ timeout: 3000 })) {
        await audioBtn.click();
        console.log("  🎵 + Audio 버튼 클릭");
        await page.waitForTimeout(1500);
      } else {
        console.log("  ⚠️  + Audio 버튼을 찾을 수 없습니다. 스크린샷 저장...");
        await page.screenshot({ path: `/tmp/suno_upload_${i}.png` });
        continue;
      }

      // 2.5) 드롭다운에서 Upload 선택
      const uploadOption = page.locator('[data-context-menu] >> text=Upload').first();
      await uploadOption.click({ force: true, timeout: 5000 });
      console.log("  📂 Upload 선택");
      await page.waitForTimeout(1000);

      // 2.6) 파일 input에 파일 설정
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(file);
      console.log("  📁 파일 선택 완료");
      await page.waitForTimeout(2000);

      // 2.7) Agree to Terms 클릭
      const agreeBtn = page.locator('button:has-text("Agree to Terms")').first();
      if (await agreeBtn.isVisible({ timeout: 5000 })) {
        await agreeBtn.click();
        console.log("  📋 Terms 동의");
        await page.waitForTimeout(3000);
      }

      // 2.8) Save 버튼 클릭
      const saveBtn = page.locator('button:has-text("Save")').first();
      if (await saveBtn.isVisible({ timeout: 10000 })) {
        await saveBtn.click();
        console.log("  💾 Save 클릭");
      } else {
        console.log("  ⚠️ Save 버튼을 찾을 수 없습니다");
        await page.screenshot({ path: `/tmp/suno_no_save_${i}.png` });
        continue;
      }

      // 2.9) 업로드 완료 대기: "Uploading" 텍스트가 사라질 때까지 폴링
      for (let t = 0; t < 60; t++) {
        await page.waitForTimeout(3000);
        const uploading = await page.evaluate(() =>
          document.body.innerText.includes("Uploading")
        );
        if (!uploading) {
          console.log(`  📦 업로드 완료 (${t * 3}초)`);
          break;
        }
        if (t % 5 === 0) process.stdout.write(`  ⏳ [${i + 1}/${files.length}] 업로드 중... ${t * 3}초\n`);
        if (t === 59) console.log("  ⚠️ 업로드 시간 초과 (3분)");
      }

      console.log(`  ✅ 완료`);

      // 다음 업로드를 위해 새로고침 (깨끗한 상태에서 시작)
      if (i < files.length - 1) {
        await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
      }
    } catch (err) {
      console.log(`  ❌ 실패: ${err.message}`);
      await page.screenshot({ path: `/tmp/suno_upload_error_${i}.png` });
      // 페이지 복구 시도
      await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
    }
  }

  console.log(`\n========================================`);
  console.log(`✅ 업로드 완료!`);
  console.log(`========================================\n`);

  // 브라우저 열어둠 (확인용)
  console.log("브라우저를 열어두었습니다. 확인 후 Ctrl+C로 종료하세요.");
  await new Promise(() => {}); // 무한 대기
}

main().catch(console.error);
