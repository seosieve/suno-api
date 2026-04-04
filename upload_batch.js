#!/usr/bin/env node
/**
 * SUNO 오디오 일괄 업로드 스크립트
 * 사용법: node upload_batch.js <폴더경로> [--headless] [--limit N] [--skip N]
 * 예: node upload_batch.js ~/Downloads/SSG_원곡_MR_slow
 */

const path = require("path");
const fs = require("fs");
const { SUNO_URL, launchAndLogin, uploadAudio } = require("./lib/browser");

async function main() {
  const dir = process.argv.filter(a => !a.startsWith("--"))[2];
  if (!dir) {
    console.log("사용법: node upload_batch.js <폴더경로> [--headless] [--limit N] [--skip N]");
    process.exit(1);
  }

  const absDir = path.resolve(dir.replace("~", process.env.HOME));
  if (!fs.existsSync(absDir)) {
    console.log(`❌ 폴더 없음: ${absDir}`);
    process.exit(1);
  }

  let files = fs.readdirSync(absDir)
    .filter(f => /\.(mp3|wav|flac|m4a)$/i.test(f))
    .sort()
    .map(f => path.join(absDir, f));

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

  console.log(`\n🎵 SUNO 일괄 업로드`);
  console.log(`📁 폴더: ${absDir}`);
  console.log(`📊 ${files.length}곡\n`);
  files.forEach((f, i) => console.log(`  ${i + 1}. ${path.basename(f)}`));

  const headless = process.argv.includes("--headless");
  const { browser, page } = await launchAndLogin({ headless });
  console.log("");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`\n📤 [${i + 1}/${files.length}] ${path.basename(file)}`);

    try {
      await uploadAudio(page, file);
      console.log("  ✅ 완료");

      if (i < files.length - 1) {
        await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
      }
    } catch (err) {
      console.log(`  ❌ 실패: ${err.message}`);
      await page.screenshot({ path: `/tmp/suno_upload_error_${i}.png` });
      await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
    }
  }

  await browser.close();
  console.log(`\n✅ 업로드 완료! (${files.length}곡)\n`);
}

main().catch(console.error);
