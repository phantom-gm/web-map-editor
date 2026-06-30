// 백엔드 공유 시크릿 — 세션 보관. 없으면 1회 프롬프트(x-editor-secret).
export function getSecret(): string {
  let s = sessionStorage.getItem("editorSecret") ?? "";
  if (!s) {
    s = window.prompt("백엔드 공유 시크릿 입력 (x-editor-secret)") ?? "";
    if (s) sessionStorage.setItem("editorSecret", s);
  }
  return s;
}
