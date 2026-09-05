// RUID → .mod CDN 경로 캐시(서버). /api/images 가 이미지를 가져오려면 modPath 가 필요한데,
// modPath 는 MCP 목록조회(asset_list_group_resources)에서만 나온다 — 이미지 1장마다 목록을 훑으면
// 느리므로 한 번 알아낸 경로를 여기 저장한다.
//
// RUID 는 내용-불변 식별자이고 modPath 는 그 리소스의 CDN 경로라 **한 번 맞으면 계속 유효**하다.
// 어댑터 선택은 registryStore 와 동일 규약(KV 있으면 KV, 없으면 프로세스 메모리).
//   ⚠ MemoryStore 는 serverless 에서 인스턴스마다 별개 — 캐시 미스가 늘 뿐 정확성 문제는 없다.

export interface ModPathStore {
  getAll(): Promise<Record<string, string>>;
  putMany(entries: Record<string, string>): Promise<void>;
}

const KV_KEY = "mod_paths";

class MemoryModPathStore implements ModPathStore {
  private data: Record<string, string> = {};
  async getAll() {
    return { ...this.data };
  }
  async putMany(entries: Record<string, string>) {
    Object.assign(this.data, entries);
  }
}

class KvModPathStore implements ModPathStore {
  constructor(
    private url: string,
    private token: string,
  ) {}
  private async cmd(args: (string | number)[]): Promise<unknown> {
    const r = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`KV ${args[0]} 실패: ${r.status}`);
    return ((await r.json()) as { result?: unknown }).result;
  }
  async getAll() {
    try {
      const raw = (await this.cmd(["GET", KV_KEY])) as string | null;
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {}; // 캐시 장애는 조용히 미스 처리 — 이미지 조회 자체는 계속된다.
    }
  }
  async putMany(entries: Record<string, string>) {
    try {
      const cur = await this.getAll();
      await this.cmd(["SET", KV_KEY, JSON.stringify({ ...cur, ...entries })]);
    } catch {
      /* 캐시 쓰기 실패는 무시 */
    }
  }
}

let _store: ModPathStore | null = null;

export function getModPathStore(): ModPathStore {
  if (_store) return _store;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  _store = url && token ? new KvModPathStore(url, token) : new MemoryModPathStore();
  return _store;
}
