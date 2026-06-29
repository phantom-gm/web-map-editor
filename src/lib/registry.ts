// RUID 레지스트리 — CLI(build_tile_registry.cjs)가 만든 tile_registry.json 을 읽어
// 팔레트 타일의 등록 여부를 판정한다.
//
// 매칭 원칙(WEB_MAP_EDITOR_RUID_LINKAGE.md §2.1, placeholder 해시중복 발견 반영):
//   1) 이름 정확매치(레지스트리는 name→ruid 1:1, 권위 있음) = 안전한 1차 키.
//   2) 해시로 검증/보조 — 같은 이름인데 내용이 다르면 conflict(자동바인딩 금지),
//      이름이 없을 때만 "유일한" 해시로 renamed 추정.
//   ⚠ placeholder 로 같은 PNG 를 공유하는 타일이 많아 해시는 유일하지 않을 수 있음 →
//      해시-단독 매칭은 후보가 정확히 1개일 때만 채택.

export interface RegistryEntry {
  name: string;
  ruid: string;
  hash: string | null;
}

export interface TileRegistry {
  byName: Map<string, RegistryEntry>;
  byHash: Map<string, RegistryEntry[]>;
}

export type RegStatus = "registered" | "renamed" | "conflict" | "new";

export interface Resolution {
  status: RegStatus;
  ruid?: string;
}

export function parseRegistry(json: unknown): TileRegistry {
  const raw = json as { entries?: RegistryEntry[] } | RegistryEntry[];
  const entries = Array.isArray(raw) ? raw : raw?.entries ?? [];
  const byName = new Map<string, RegistryEntry>();
  const byHash = new Map<string, RegistryEntry[]>();
  for (const e of entries) {
    if (!e || !e.name || !e.ruid) continue;
    byName.set(e.name, e);
    if (e.hash) {
      const arr = byHash.get(e.hash);
      if (arr) arr.push(e);
      else byHash.set(e.hash, [e]);
    }
  }
  return { byName, byHash };
}

/** 이름(+선택 해시)으로 레지스트리에서 RUID 판정. */
export function resolveTile(
  reg: TileRegistry,
  name: string,
  hash?: string | null,
): Resolution {
  const nameHit = reg.byName.get(name);
  if (nameHit) {
    // 같은 이름, 다른 내용 → 다른 그림에 같은 이름을 붙인 것. 자동바인딩 금지.
    if (nameHit.hash && hash && nameHit.hash !== hash) return { status: "conflict" };
    return { status: "registered", ruid: nameHit.ruid };
  }
  if (hash) {
    const hits = reg.byHash.get(hash);
    if (hits && hits.length === 1) return { status: "renamed", ruid: hits[0].ruid };
  }
  return { status: "new" };
}
