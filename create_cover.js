#!/usr/bin/env node
/**
 * SUNO 커버 자동 생성 스크립트
 * 사용법: node create_cover.js <파일경로 또는 폴더> [--headless] [--limit N] [--skip N]
 * 예: node create_cover.js ~/Downloads/SSG_원곡_MR_slow/01_우린\ 랜더스.mp3
 *     node create_cover.js ~/Downloads/SSG_원곡_MR_slow --limit 3
 */

const path = require("path");
const fs = require("fs");
const { SUNO_URL, launchAndLogin, uploadAudio, deleteSong, handleCaptcha } = require("./lib/browser");

const STYLE_TEXT = `lofi piano cover, chill lo-fi beats, slow tempo, relaxed, ambient, soft retro vibes, instrumental, lush pads, warm synth layers, vinyl crackle, soft brushed drums, gentle hi-hats, dreamy, mellow, ‑vocals, ‑singing, ‑chanting, ‑voice, ‑chorus`;

async function main() {
  const args = process.argv.filter(a => !a.startsWith("--"));
  const target = args[2];
  if (!target) {
    console.log("사용법: node create_cover.js <파일경로 또는 폴더> [--headless] [--limit N] [--skip N]");
    process.exit(1);
  }

  const absTarget = path.resolve(target.replace("~", process.env.HOME));
  if (!fs.existsSync(absTarget)) {
    console.log(`❌ 경로 없음: ${absTarget}`);
    process.exit(1);
  }

  // 파일 목록 구성 (파일 1개 또는 폴더 내 오디오 파일들)
  let files;
  if (fs.statSync(absTarget).isDirectory()) {
    files = fs.readdirSync(absTarget)
      .filter(f => /\.(mp3|wav|flac|m4a)$/i.test(f))
      .sort()
      .map(f => path.join(absTarget, f));
  } else {
    files = [absTarget];
  }

  // --skip, --limit 옵션
  const skipIdx = process.argv.indexOf("--skip");
  const limitIdx = process.argv.indexOf("--limit");
  const skip = skipIdx !== -1 ? parseInt(process.argv[skipIdx + 1]) : 0;
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : files.length;
  files.splice(0, skip);
  files.splice(limit);

  if (files.length === 0) {
    console.log("❌ 오디오 파일 없음");
    process.exit(1);
  }

  console.log(`\n🎵 SUNO 커버 생성`);
  console.log(`📊 ${files.length}곡\n`);
  files.forEach((f, i) => console.log(`  ${i + 1}. ${path.basename(f)}`));

  // 브라우저 실행 + 로그인
  const headless = process.argv.includes("--headless");
  const { browser, page } = await launchAndLogin({ headless });
  console.log("");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = path.basename(file);
    const songName = name.replace(/\.(mp3|wav|flac|m4a)$/i, "");
    console.log(`\n━━━ [${i + 1}/${files.length}] ${name} ━━━`);

    try {
      // 1) 업로드
      const uploaded = await uploadAudio(page, file);
      if (!uploaded) {
        console.log("  ❌ 업로드 실패, 다음 곡으로");
        await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        continue;
      }
      await page.waitForTimeout(2000);

      // 2) 원본 삭제 (업로드 직후, 오른쪽 리스트에서)
      console.log("🗑️ 원본 삭제...");
      await deleteSong(page, songName);

      // 3) Lyrics 비우기
      console.log("📝 Lyrics 비우기...");
      try {
        const lyricsClearBtn = page.locator('text=Lyrics').locator('..').locator('button').nth(2);
        await lyricsClearBtn.click({ timeout: 3000 });
        console.log("✅ Lyrics 비움");
      } catch (_) {
        const lyricsArea = page.locator('textarea').first();
        await lyricsArea.click({ clickCount: 3 });
        await page.waitForTimeout(300);
        await page.keyboard.press("Backspace");
        for (let j = 0; j < 10; j++) {
          await page.keyboard.press("Meta+a");
          await page.keyboard.press("Backspace");
        }
        console.log("✅ Lyrics 비움");
      }
      await page.waitForTimeout(1000);

      // 3) Styles 설정
      console.log("🎨 Styles 설정...");
      const stylesArea = page.locator('textarea').nth(1);
      await stylesArea.click();
      await stylesArea.fill("");
      await page.waitForTimeout(500);
      await stylesArea.fill(STYLE_TEXT);
      console.log("✅ Styles 입력 완료");
      await page.waitForTimeout(1000);

      // 4) More Options + 슬라이더
      console.log("⚙️ More Options...");
      const moreOptions = page.locator('text=More Options').first();
      if (await moreOptions.isVisible({ timeout: 3000 })) {
        await moreOptions.click();
        await page.waitForTimeout(1000);
      }

      async function setSlider(label, targetPercent) {
        try {
          const row = page.locator(`text=${label}`).locator('..').locator('..');
          const percentText = row.locator('text=/%$/');
          await percentText.dblclick({ timeout: 3000 });
          await page.waitForTimeout(300);
          await page.keyboard.press("Meta+a");
          await page.keyboard.type(String(targetPercent));
          await page.keyboard.press("Enter");
          console.log(`  ✅ ${label}: ${targetPercent}%`);
        } catch (e) {
          console.log(`  ⚠️ ${label} 설정 실패: ${e.message}`);
        }
        await page.waitForTimeout(500);
      }

      await setSlider("Weirdness", 20);
      await setSlider("Style Influence", 70);
      await setSlider("Audio Influence", 20);

      // 5) Create + 캡차
      console.log("\n🚀 Create...");
      const createBtn = page.locator('button:has-text("Create")').first();
      if (await createBtn.isVisible({ timeout: 5000 })) {
        await createBtn.click();
        console.log("✅ Create 클릭");
        await handleCaptcha(page, createBtn);
      } else {
        console.log("❌ Create 버튼 없음");
        await page.screenshot({ path: `/tmp/suno_cover_err_${i}.png` });
      }

      console.log("🎶 곡 생성 시작!");
      await page.waitForTimeout(3000);

      // 다음 곡을 위해 create 페이지로
      if (i < files.length - 1) {
        await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
      }
    } catch (err) {
      console.log(`❌ 실패: ${err.message}`);
      await page.screenshot({ path: `/tmp/suno_cover_error_${i}.png` });
      await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
    }
  }

  await browser.close();
  console.log(`\n========================================`);
  console.log(`✅ 전체 완료! (${files.length}곡)`);
  console.log(`========================================\n`);
}

main().catch(console.error);
