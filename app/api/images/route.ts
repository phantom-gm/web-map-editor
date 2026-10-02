// RUID -> latest original PNG and native metrics. Resource lookup is by GUID, not a
// truncated group listing: older trees/buildings can be beyond the first 4,000 items.
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { withMcpClient, getGroupResourceMetadata, fetchSpriteAsset } from "../../../src/server/mswMcp";
import { runPool } from "../../../src/lib/pool";
import type { SpriteAssetsResponse } from "../../../src/lib/spriteAsset";

const IMG_CONCURRENCY = 8;
const MAX_RUIDS = 500;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ruids?: unknown } | null;
  const raw = Array.isArray(body?.ruids) ? body.ruids : null;
  if (!raw || raw.some(r => typeof r !== "string" || !/^[0-9a-f]{32}$/i.test(r))) {
    return NextResponse.json({ error: "ruids에는 32자리 RUID 문자열 배열이 필요합니다." }, { status: 400 });
  }
  const ruids = [...new Set(raw as string[])];
  if (ruids.length > MAX_RUIDS) {
    return NextResponse.json({ error: "한 번에 최대 500개 RUID를 조회할 수 있습니다." }, { status: 400 });
  }
  if (!ruids.length) return NextResponse.json({ images: {}, sprites: {}, errors: {}, resolved: 0, missing: 0 });

  try {
    // Metadata is refreshed on each request; a RUID can keep its identity after a data/pivot update.
    const resources = await withMcpClient(client => getGroupResourceMetadata(client, ruids));
    const result: SpriteAssetsResponse = { images: {}, sprites: {}, errors: {} };
    await runPool(IMG_CONCURRENCY, ruids.length, async i => {
      const ruid = ruids[i], resource = resources.get(ruid);
      result.images[ruid] = null;
      if (!resource) {
        result.errors[ruid] = "resource-not-found";
        return;
      }
      if (resource.resourceType !== "sprite" || !resource.modPath) {
        result.errors[ruid] = "unsupported-resource-type";
        return;
      }
      try {
        const asset = await fetchSpriteAsset(resource);
        result.images[ruid] = asset.imageUrl;
        if (asset.metadata) result.sprites[ruid] = asset.metadata;
        if (asset.error) result.errors[ruid] = asset.error;
      } catch {
        result.errors[ruid] = "sprite-download-failed";
      }
    });
    const resolved = Object.values(result.images).filter(Boolean).length;
    return NextResponse.json(
      { ...result, resolved, missing: ruids.length - resolved },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
