/**
 * SUNO 브라우저 자동화 공통 모듈
 * 브라우저 실행, 쿠키 설정, 로그인, 팝업 닫기, 캡차 해결
 */

const { chromium } = require("rebrowser-playwright-core");
const path = require("path");
const fs = require("fs");
const { Solver } = require("@2captcha/captcha-solver");
require("dotenv").config();

const SUNO_URL = "https://suno.com/create";
const solver = new Solver(process.env.TWOCAPTCHA_KEY);

// ─── 브라우저 초기화 ───

/**
 * 브라우저 실행 → 쿠키 설정 → SUNO 접속 → 로그인 확인 → 팝업 닫기
 * @returns {{ browser, context, page }}
 */
async function launchAndLogin(options = {}) {
  const { headless = false, slowMo = 500 } = options;

  const browser = await chromium.launch({ headless, slowMo });
  // locale을 en-US로 강제 → hCaptcha가 영어 챌린지로 뜸
  // (한국어 챌린지는 2captcha 워커 풀이 얕아 오답률이 높음)
  const context = await browser.newContext({
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });

  // 쿠키 설정
  const cookieStr = process.env.SUNO_COOKIE;
  if (!cookieStr) {
    console.log("❌ SUNO_COOKIE가 .env에 설정되어 있지 않습니다");
    await browser.close();
    process.exit(1);
  }

  const cookies = cookieStr.split(";").map(c => {
    const [n, ...rest] = c.trim().split("=");
    return { name: n.trim(), value: rest.join("=").trim(), domain: ".suno.com", path: "/" };
  }).filter(c => c.name && c.value);

  await context.addCookies(cookies);
  const page = await context.newPage();

  // SUNO 접속
  console.log("🔐 SUNO 접속 중...");
  await page.goto(SUNO_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);

  // 쿠키 동의
  try {
    const acceptBtn = page.locator('button:has-text("Accept All Cookies")').first();
    if (await acceptBtn.isVisible({ timeout: 3000 })) {
      await acceptBtn.click();
      console.log("🍪 쿠키 동의 완료");
      await page.waitForTimeout(2000);
    }
  } catch (_) {}

  // 로그인 확인
  if (page.url().includes("accounts") || page.url().includes("sign-in")) {
    console.log("❌ 로그인 실패 — 쿠키가 만료되었을 수 있습니다");
    await browser.close();
    process.exit(1);
  }
  console.log("✅ 로그인 성공");

  // 팝업 닫기
  for (const sel of [
    'button[aria-label="Close"]',
    'button:has-text("Close")',
    '[data-testid="close-icon"]',
    'svg[data-testid="close-icon"]',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        console.log("🔲 팝업 닫기 완료");
        await page.waitForTimeout(1000);
        break;
      }
    } catch (_) {}
  }

  return { browser, context, page };
}

// ─── 파일 업로드 ───

/**
 * Advanced 탭 → +Audio → Upload → 파일 선택 → Agree → Save → 업로드 완료 대기
 */
async function uploadAudio(page, filePath) {
  // Advanced 탭
  const advancedTab = page.locator('button:has-text("Advanced"), [role="tab"]:has-text("Advanced")').first();
  if (await advancedTab.isVisible({ timeout: 5000 })) {
    await advancedTab.click();
    console.log("🔧 Advanced 탭 선택");
    await page.waitForTimeout(1500);
  } else {
    console.log("❌ Advanced 탭 없음");
    await page.screenshot({ path: "/tmp/suno_no_advanced.png" });
    return false;
  }

  // +Audio 버튼
  const audioBtn = page.locator('button:has-text("Audio"), button:has-text("+ Audio")').first();
  if (await audioBtn.isVisible({ timeout: 3000 })) {
    await audioBtn.click();
    console.log("🎵 +Audio 버튼 클릭");
    await page.waitForTimeout(1500);
  } else {
    console.log("❌ +Audio 버튼 없음");
    return false;
  }

  // Upload 선택
  const uploadOption = page.locator('[data-context-menu] >> text=Upload').first();
  await uploadOption.click({ force: true, timeout: 5000 });
  console.log("📂 Upload 선택");
  await page.waitForTimeout(1000);

  // 파일 선택
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath);
  console.log("📁 파일 선택 완료");
  await page.waitForTimeout(2000);

  // Agree to Terms
  const agreeBtn = page.locator('button:has-text("Agree to Terms")').first();
  if (await agreeBtn.isVisible({ timeout: 5000 })) {
    await agreeBtn.click();
    console.log("📋 Terms 동의");
    await page.waitForTimeout(3000);
  }

  // Save
  const saveBtn = page.locator('button:has-text("Save")').first();
  if (await saveBtn.isVisible({ timeout: 10000 })) {
    await saveBtn.click();
    console.log("💾 Save 클릭");
  }

  // 업로드 완료 대기 (최대 10분 — 긴 곡도 안전하게)
  const MAX_WAIT_SEC = 600;
  const POLL_SEC = 3;
  const MAX_POLLS = MAX_WAIT_SEC / POLL_SEC;
  for (let t = 0; t < MAX_POLLS; t++) {
    await page.waitForTimeout(POLL_SEC * 1000);
    const uploading = await page.evaluate(() =>
      document.body.innerText.includes("Uploading")
    );
    if (!uploading) {
      console.log(`📦 업로드 완료 (${t * POLL_SEC}초)`);
      return true;
    }
    if (t % 5 === 0) console.log(`⏳ 업로드 중... ${t * POLL_SEC}초`);
  }

  console.log(`❌ 업로드 시간 초과 (${MAX_WAIT_SEC / 60}분) — 실패 처리`);
  return false;
}

// ─── 곡 삭제 ───

/**
 * Uploads 탭에서 곡 이름으로 찾아서 우클릭 → Move to Trash
 */
async function deleteSong(page, songName) {
  // Upload 뱃지 + 이름 매칭 (엄격). 생성된 커버 곡도 같은 이름을 가지므로
  // Upload 뱃지가 없는 폴백은 제거 — 잘못 삭제 방지.
  const candidates = page.locator('.clip-row:has-text("Upload")').filter({ hasText: songName });
  const count = await candidates.count().catch(() => 0);

  if (count === 0) {
    console.log(`⚠️ "${songName}" (Upload 뱃지 행) 없음 — 삭제 스킵`);
    return false;
  }
  if (count > 1) {
    console.log(`⚠️ "${songName}" Upload 행이 ${count}개 — 혼동 방지 위해 삭제 스킵`);
    return false;
  }

  const targetRow = candidates.first();
  if (!(await targetRow.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log(`⚠️ "${songName}" 행 보이지 않음 — 삭제 스킵`);
    return false;
  }

  // 우클릭으로 컨텍스트 메뉴 열기
  await targetRow.click({ button: "right" });
  await page.waitForTimeout(1000);

  const trashBtn = page.locator('text=Move to Trash').first();
  if (await trashBtn.isVisible({ timeout: 3000 })) {
    await trashBtn.click();
    console.log(`🗑️ "${songName}" 삭제 완료`);
    await page.waitForTimeout(2000);
    return true;
  } else {
    console.log("⚠️ Move to Trash를 찾을 수 없습니다");
    await page.screenshot({ path: "/tmp/suno_delete_no_trash.png" });
    return false;
  }
}

// ─── 캡차 해결 ───

/**
 * 2Captcha에 스크린샷을 보내서 클릭 좌표를 받아옴 (최대 3회 재시도)
 */
async function solveCaptcha(challenge, isDrag) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log(`  🧩 2Captcha에 캡차 전송 중... (시도 ${attempt + 1}/3)`);
      const payload = {
        body: (await challenge.screenshot({ timeout: 5000 })).toString("base64"),
        lang: process.env.BROWSER_LOCALE || "en",
      };
      if (isDrag) {
        payload.textinstructions = "CLICK on the shapes at their edge or center as shown above—please be precise!";
        const instrPath = path.join(process.cwd(), "public", "drag-instructions.jpg");
        if (fs.existsSync(instrPath)) {
          payload.imginstructions = fs.readFileSync(instrPath).toString("base64");
        }
      }
      return await solver.coordinates(payload);
    } catch (err) {
      console.log(`  ⚠️ 2Captcha 실패: ${err.message}`);
      if (attempt === 2) throw err;
      console.log("  🔄 재시도...");
    }
  }
  return null;
}

/**
 * Create 클릭 후 캡차 감지 → 자동 해결
 *
 * 성공 판정은 iframe visibility가 아니라 SUNO generate API로의 POST 전송을 관찰해
 * 결정한다. hCaptcha는 틀린 답에도 iframe을 잠깐 갱신하며 invisible 상태가 되는
 * 틈이 있어 visibility 기반 판정은 false positive가 발생한다.
 * (src/lib/SunoApi.ts의 tokenPromise 패턴 참고 — 거기서는 route.abort()로 요청을
 *  가로채 토큰만 뽑지만, 여기서는 실제로 생성이 진행돼야 하므로 request 이벤트만 관찰)
 */
async function handleCaptcha(page, createBtn) {
  // ─── 성공 판정: generate API POST 관찰 ───
  let tokenAccepted = false;
  const requestListener = (request) => {
    try {
      if (request.method() !== "POST") return;
      const url = request.url();
      if (!/\/api\/(generate|gen|song)/.test(url)) return;
      const post = request.postDataJSON?.();
      // hcaptcha_token 또는 token 필드가 포함돼 POST되면 SUNO가 수락한 것
      if (post && (post.token || post.hcaptcha_token || post.captcha_token)) {
        tokenAccepted = true;
        console.log(`  🛰️  API 토큰 전송 감지: ${url.split("?")[0].split("/").slice(-3).join("/")}`);
      } else if (/\/api\/generate\//.test(url)) {
        // body 파싱 실패해도 generate 엔드포인트로의 POST 자체가 성공 신호
        tokenAccepted = true;
        console.log(`  🛰️  generate POST 감지: ${url.split("?")[0].split("/").slice(-3).join("/")}`);
      }
    } catch (_) {}
  };
  page.on("request", requestListener);

  const cleanup = () => page.off("request", requestListener);

  try {
    const iframeSelectors = [
      'iframe[title*="hCaptcha"]',
      'iframe[title*="captcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[data-hcaptcha-widget-id]',
    ];

    let frame = null;
    let challenge = null;

    // 캡차가 뜨는지 최대 15초 대기 (중간에 토큰 감지되면 즉시 종료)
    for (let t = 0; t < 15; t++) {
      if (tokenAccepted) {
        console.log("  ✅ 캡차 없이 통과 (API 토큰 전송 확인)");
        return;
      }
      for (const sel of iframeSelectors) {
        try {
          const iframe = page.locator(sel).first();
          if (await iframe.isVisible({ timeout: 500 })) {
            frame = page.frameLocator(sel);
            challenge = frame.locator(".challenge-container");
            if (await challenge.isVisible({ timeout: 1000 })) {
              console.log(`  🔍 캡차 iframe 발견: ${sel}`);
              break;
            }
            frame = null;
            challenge = null;
          }
        } catch (_) {}
      }
      if (frame) break;
      await page.waitForTimeout(1000);
    }

    if (!frame || !challenge) {
      if (tokenAccepted) {
        console.log("  ✅ 캡차 없이 통과 (API 토큰 전송 확인)");
      } else {
        console.log("  ✅ 캡차 없음 — 바로 통과");
      }
      return;
    }

    console.log("  🔐 캡차 감지! 자동 해결 시작...");

    let shouldWaitForImages = true;
    for (let round = 0; round < 10; round++) {
      try {
        if (tokenAccepted) {
          console.log("  🎉 캡차 해결 완료! (API 토큰 전송 확인)");
          return;
        }

        if (shouldWaitForImages) {
          await page.waitForTimeout(3000);
        }

        if (tokenAccepted) {
          console.log("  🎉 캡차 해결 완료! (API 토큰 전송 확인)");
          return;
        }

        // 캡차 타입 확인
        let isDrag = false;
        try {
          const promptText = await challenge.locator(".prompt-text").first().innerText({ timeout: 3000 });
          isDrag = promptText.toLowerCase().includes("drag");
          console.log(`  📋 캡차 유형: ${isDrag ? "드래그" : "클릭"} — "${promptText}"`);
        } catch (_) {
          if (tokenAccepted) {
            console.log("  🎉 캡차 해결 완료! (API 토큰 전송 확인)");
            return;
          }
          console.log("  📋 캡차 유형: 클릭 (기본)");
        }

        const solution = await solveCaptcha(challenge, isDrag);
        if (!solution) throw new Error("캡차 해결 실패");

        if (isDrag) {
          if (solution.data.length % 2 !== 0) {
            console.log("  ⚠️ 드래그 좌표가 홀수 — 재시도");
            solver.badReport(solution.id);
            shouldWaitForImages = false;
            continue;
          }
          const box = await challenge.boundingBox();
          if (!box) throw new Error("challenge boundingBox가 null");
          // 드래그 수행
          for (let i = 0; i < solution.data.length; i += 2) {
            const start = solution.data[i];
            const end = solution.data[i + 1];
            await page.mouse.move(box.x + +start.x, box.y + +start.y);
            await page.mouse.down();
            await page.waitForTimeout(1100);
            await page.mouse.move(box.x + +end.x, box.y + +end.y, { steps: 30 });
            await page.mouse.up();
          }
        } else {
          // 클릭 수행
          for (const coord of solution.data) {
            await challenge.click({ position: { x: +coord.x, y: +coord.y } });
          }
        }

        shouldWaitForImages = true;

        // Submit 버튼 클릭
        try {
          await frame.locator(".button-submit").click({ timeout: 3000 });
          console.log("  ✅ 캡차 제출");
        } catch (e) {
          if (e.message.includes("viewport")) {
            await createBtn.click();
          } else {
            throw e;
          }
        }

        // 성공 판정 poll: 최대 10초 동안 tokenAccepted / 다음 챌린지 여부 감시
        const pollStart = Date.now();
        let nextChallengeReady = false;
        while (Date.now() - pollStart < 10000) {
          if (tokenAccepted) {
            console.log("  🎉 캡차 해결 완료! (API 토큰 전송 확인)");
            solver.goodReport?.(solution.id);
            return;
          }
          // 다음 라운드 챌린지가 준비됐는지 (prompt-text가 다시 보이는지)
          const promptVisible = await challenge
            .locator(".prompt-text")
            .first()
            .isVisible({ timeout: 300 })
            .catch(() => false);
          if (promptVisible) {
            nextChallengeReady = true;
            break;
          }
          await page.waitForTimeout(500);
        }

        if (tokenAccepted) {
          console.log("  🎉 캡차 해결 완료! (API 토큰 전송 확인)");
          solver.goodReport?.(solution.id);
          return;
        }

        if (nextChallengeReady) {
          console.log("  🔄 캡차 추가 라운드 — 이전 답 오답 처리");
          try { solver.badReport?.(solution.id); } catch (_) {}
        } else {
          console.log("  🔄 캡차 추가 라운드...");
        }
      } catch (err) {
        if (tokenAccepted) {
          console.log("  🎉 캡차 해결 완료! (API 토큰 전송 확인)");
          return;
        }
        if (err.message.includes("been closed")) return;
        console.log(`  ❌ 캡차 라운드 ${round + 1} 실패: ${err.message}`);
      }
    }
    console.log("  ⚠️ 캡차 10라운드 초과 — 수동으로 풀어주세요");
  } finally {
    cleanup();
  }
}

module.exports = {
  SUNO_URL,
  launchAndLogin,
  uploadAudio,
  deleteSong,
  handleCaptcha,
};
