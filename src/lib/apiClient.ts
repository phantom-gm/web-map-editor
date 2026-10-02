// 백엔드 /api 클라이언트. 읽기(조회/판정)는 무인증, 쓰기(업로드)만 x-editor-secret 전송.
import type { RegStatus } from "./registry";
import type { SpriteAssetsResponse } from "./spriteAsset";
export type { SpriteMetadata, SpriteAssetsResponse } from "./spriteAsset";

export interface ResolveResult {
  name: string;
  status: RegStatus;
  ruid: string | null;
}

export interface UploadResult {
  uploaded: Array<{ name: string; ruid: string }>;
  skipped: Array<{ name: string; ruid: string; reason: string }>;
  failed: Array<{ name: string; error: string }>;
}

// secret 이 있으면 x-editor-secret 헤더 첨부(쓰기 전용). 읽기는 secret 없이 호출.
async function postJson(path: string, body: unknown, secret?: string, signal?: AbortSignal) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["x-editor-secret"] = secret;
  const r = await fetch(path, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (r.status === 401) throw new Error("인증 실패 — 공유 시크릿을 확인하세요.");
  if (!r.ok) throw new Error(`${path} 실패: HTTP ${r.status}`);
  return r.json();
}

/** 서버 레지스트리로 등록/신규 판정. 읽기 전용 — 시크릿 불필요. */
export async function resolveTiles(
  tiles: Array<{ name: string; hash?: string | null }>,
): Promise<ResolveResult[]> {
  const j = (await postJson("/api/resolve", { tiles })) as { results: ResolveResult[] };
  return j.results;
}

/** 신규 타일 PNG 업로드(미등록만). dataBase64 = dataURL 의 base64 부분. */
export async function uploadTiles(
  tiles: Array<{ name: string; hash?: string | null; dataBase64: string }>,
  secret: string,
): Promise<UploadResult> {
  return (await postJson("/api/upload", { tiles }, secret)) as UploadResult;
}

export interface ResourceItem {
  ruid: string;
  name: string;
  subcategory: string;
  imageUrl: string | null; // .mod 추출 PNG 의 dataURL (없으면 null)
}
export interface ResourceListResult {
  items: ResourceItem[];
  nextCursor: string | null;
}

/**
 * RUID 배치 → 실제 PNG dataURL(읽기 전용). 프로젝트 파일 v2 가 base64 를 안 갖는 대신 이 경로로
 * 이미지를 복원한다. 값이 null 인 RUID = 스토리지에서 못 찾음(→ 폴백 스와치).
 */
export async function fetchImages(ruids: string[]): Promise<Record<string, string | null>> {
  return (await fetchSpriteAssets(ruids)).images;
}

/** Fresh native metrics and original images. Chunk requests so large maps are never truncated. */
export async function fetchSpriteAssets(ruids: string[], signal?: AbortSignal): Promise<SpriteAssetsResponse> {
  const unique = [...new Set(ruids)];
  const result: SpriteAssetsResponse = { images: {}, sprites: {}, errors: {} };
  for (let i = 0; i < unique.length; i += 100) {
    signal?.throwIfAborted();
    const batch = unique.slice(i, i + 100);
    const response = (await postJson("/api/images", { ruids: batch }, undefined, signal)) as Partial<SpriteAssetsResponse>;
    for (const ruid of batch) {
      result.images[ruid] = response.images?.[ruid] ?? null;
      if (response.sprites?.[ruid]) result.sprites[ruid] = response.sprites[ruid];
      if (response.errors?.[ruid]) result.errors[ruid] = response.errors[ruid];
      else if (!response.images?.[ruid]) result.errors[ruid] = "image-unresolved";
    }
  }
  return result;
}

/** 그룹 소유 리소스 목록 + 썸네일 URL 조회(읽기 전용). 시크릿 불필요. cursor 로 페이지네이션. */
export async function listResources(
  params: { category?: string; subcategory?: string; count?: number; searchWord?: string | null; cursor?: string | null },
): Promise<ResourceListResult> {
  return (await postJson("/api/resources", params)) as ResourceListResult;
}
