#!/usr/bin/env python3
"""SUNO 플레이리스트 생성 (HTTP API, Safari 쿠키 사용)
사용법: python3 create_playlist.py "<플레이리스트 이름>" [--cover <이미지경로>]
"""

import sys
import json
import subprocess
import requests

BASE = "https://studio-api.prod.suno.com"


def get_token_from_safari():
    script = '''
    tell application "Safari"
        repeat with w in windows
            repeat with t in tabs of w
                if URL of t starts with "https://suno.com" or URL of t starts with "https://studio-api.prod.suno.com" then
                    return do JavaScript "document.cookie" in t
                end if
            end repeat
        end repeat
    end tell
    return ""
    '''
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=5)
    for part in result.stdout.split(";"):
        part = part.strip()
        if part.startswith("__session=") and not part.startswith("__session_"):
            return part[len("__session="):]
    return None


def set_cover(playlist_id, name, image_path, headers):
    import base64, io
    from PIL import Image
    src = Image.open(image_path).convert("RGB")
    # 검은 정사각 캔버스 + 가운데에 90% 크기로 얹기 (letterbox)
    canvas_size = 512
    inner = int(canvas_size * 0.9)
    src.thumbnail((inner, inner), Image.LANCZOS)
    img = Image.new("RGB", (canvas_size, canvas_size), (0, 0, 0))
    img.paste(src, ((canvas_size - src.width) // 2, (canvas_size - src.height) // 2))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode()
    data_url = f"data:image/jpeg;base64,{b64}"
    print(f"  📐 리사이즈 후 {len(buf.getvalue())//1024}KB")

    payload = {
        "playlist_id": playlist_id,
        "name": name,
        "description": "",
        "image_url": data_url,
    }
    r = requests.post(
        f"{BASE}/api/playlist/set_metadata",
        headers=headers,
        json=payload,
    )
    print(f"set_metadata ← {r.status_code}: {r.text[:300]}")
    return r.status_code == 200


def main():
    if len(sys.argv) < 2:
        print('사용법: python3 create_playlist.py "<이름>" [--cover <이미지경로>] [clip_id ...]')
        sys.exit(1)

    name = sys.argv[1]
    args = sys.argv[2:]
    cover_path = None
    if "--cover" in args:
        i = args.index("--cover")
        cover_path = args[i + 1]

    token = get_token_from_safari()
    if not token:
        print("❌ Safari에서 SUNO 토큰을 가져올 수 없습니다")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # 플레이리스트 생성
    r = requests.post(
        f"{BASE}/api/playlist/create/",
        headers=headers,
        data=json.dumps({"name": name}),
    )
    if r.status_code not in (200, 201):
        print(f"❌ 생성 실패 ({r.status_code}): {r.text[:300]}")
        sys.exit(1)
    created = r.json()
    pid = created.get("id") or created.get("playlist_id")
    print(f"✅ 플레이리스트 생성: {pid}")

    # 커버 설정
    if cover_path and pid:
        print(f"🖼️  커버 설정: {cover_path}")
        set_cover(pid, name, cover_path, headers)


if __name__ == "__main__":
    main()
