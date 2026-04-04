#!/usr/bin/env node
/**
 * SUNO 업로드 오디오 삭제 스크립트
 * 사용법: node remove_batch.js <곡이름> [--headless]
 * 예: node remove_batch.js "01_우린 랜더스"
 */

const { SUNO_URL, launchAndLogin, deleteSong } = require("./lib/browser");

async function main() {
  const songName = process.argv.filter(a => !a.startsWith("--"))[2];
  if (!songName) {
    console.log('사용법: node remove_batch.js <곡이름> [--headless]');
    console.log('예: node remove_batch.js "01_우린 랜더스"');
    process.exit(1);
  }

  console.log(`\n🗑️ SUNO 삭제: ${songName}`);

  const headless = process.argv.includes("--headless");
  const { browser, page } = await launchAndLogin({ headless });

  await deleteSong(page, songName);

  await browser.close();
  console.log("");
}

main().catch(console.error);
