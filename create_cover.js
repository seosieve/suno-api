#!/usr/bin/env node
/**
 * SUNO 커버 자동 생성 스크립트
 * 사용법: node create_cover.js <파일경로 또는 폴더> [--headless] [--limit N] [--skip N]
 * 예: node create_cover.js ~/Downloads/SSG_원곡_MR_slow/01_우린\ 랜더스.mp3
 *     node create_cover.js ~/Downloads/SSG_원곡_MR_slow --limit 3
 */

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

// caffeinate 자동 적용 (잠자기 방지)
if (!process.env.CAFFEINATED) {
  process.env.CAFFEINATED = "1";
  const r = spawnSync("caffeinate", ["-dims", process.execPath, ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(r.status || 0);
}
const { SUNO_URL, launchAndLogin, uploadAudio, deleteSong, handleCaptcha } = require("./lib/browser");

function autoDetectPlaylist(targetPath) {
  // 폴더명에서 _MR/_MR_slow 등 접미사 제거 → 팀명 (예: "SAMSUNG LIONS_MR_slow" → "SAMSUNG LIONS")
  const teamName = path.basename(targetPath).replace(/_MR(_slow)?$/, "").replace(/_원곡.*$/, "");

  // raw./EP*/loops/{teamName}.png 검색 (가장 최근 EP)
  const rawDir = "/Users/seosieve/Documents/PlayList/raw.";
  if (!fs.existsSync(rawDir)) return { name: teamName, cover: null };
  const eps = fs.readdirSync(rawDir).filter(f => f.startsWith("EP")).sort().reverse();
  for (const ep of eps) {
    const cover = path.join(rawDir, ep, "loops", `${teamName}.png`);
    if (fs.existsSync(cover)) return { name: teamName, cover };
  }
  return { name: teamName, cover: null };
}

function createPlaylist(name, coverPath) {
  console.log(`\n📋 플레이리스트 생성: ${name}`);
  const args = [path.join(__dirname, "create_playlist.py"), name];
  if (coverPath) args.push("--cover", coverPath);
  const r = spawnSync("python3", args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.log("⚠️ 플레이리스트 생성 실패 — 계속 진행");
  }
}

const STYLE_TEXT = `lofi piano cover, chill lo-fi beats, mid tempo, gently uplifting, warm, soft retro vibes, instrumental, bright pads, shimmering synth layers, soft brushed drums, crisp hi-hats, light bells, airy, softly hopeful`;

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

  // 플레이리스트 자동 생성
  const detected = autoDetectPlaylist(absTarget);
  if (detected) {
    console.log(`\n🔍 자동 감지: ${detected.name} (cover: ${detected.cover ? "✓" : "✗"})`);
    createPlaylist(detected.name, detected.cover);
  } else {
    console.log("\n⚠️ 팀 자동 감지 실패 — 플레이리스트 생성 건너뜀");
  }

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

      // 2) Lyrics 비우기 (placeholder 기반)
      console.log("📝 Lyrics 비우기...");
      try {
        await page.locator('textarea[placeholder*="lyrics" i]').first().fill("");
        console.log("✅ Lyrics 비움");
      } catch (e) {
        console.log(`⚠️ Lyrics 비우기 스킵: ${e.message.split('\n')[0]}`);
      }
      await page.waitForTimeout(500);

      // 4) Styles 설정
      console.log("🎨 Styles 설정...");
      try {
        await page.locator('textarea[maxlength="1000"]').first().fill(STYLE_TEXT);
        console.log("✅ Styles 입력 완료");
      } catch (e) {
        console.log(`❌ Styles 실패: ${e.message.split('\n')[0]}`);
      }
      await page.waitForTimeout(1000);

      // 5) More Options + 슬라이더
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

      // 6) Create + 캡차 — popup 닫고 force click
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      console.log("\n🚀 Create...");
      const createBtn = page.locator('button:has-text("Create")').last();
      try {
        await createBtn.click({ force: true, timeout: 5000 });
        console.log("✅ Create 클릭");
        await handleCaptcha(page, createBtn);
      } catch (e) {
        console.log(`❌ Create 클릭 실패: ${e.message.split('\n')[0]}`);
        await page.screenshot({ path: `/tmp/suno_cover_err_${i}.png` });
      }

      console.log("🎶 곡 생성 시작!");
      // 생성이 시작되고 form이 source audio를 확실히 잡은 뒤에 원본 삭제.
      // (업로드 직후 삭제하면 form audio 참조가 끊겨 커버가 아닌 단일 곡으로 생성되는 레이스가 있었음)
      await page.waitForTimeout(5000);
      console.log("🗑️ 원본 삭제...");
      await deleteSong(page, songName);

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
