// RUID 레지스트리 영속 저장 — name↔RUID. /api 는 이 인터페이스 뒤에서만 동작하므로
// 사용자가 원하면 자체 DB 어댑터로 교체 가능(WEB_MAP_EDITOR_RUID_LINKAGE.md §7.9).
//
// 기본 어댑터:
//   - KV 환경변수(KV_REST_API_URL + KV_REST_API_TOKEN, Vercel KV/Upstash REST)가 있으면 KvStore.
//   - 없으면 MemoryStore(시드 bundled). MemoryStore 의 append 는 프로세스 내에서만 유지(비영속).
// 저장은 단일 JSON blob(키 1개) read-modify-write.
// ⚠ 동시 업로드 요청이 겹치면 RMW 가 마지막-쓰기-우선으로 충돌 가능 — 기획자 1인 도구라 허용.
//   여러 명이 동시에 업로드할 환경이면 KV per-field(HSET) 원자연산으로 교체할 것.

import seedJson from "../../data/registry.seed.json";
import type { RegistryEntry } from "../lib/registry";

export type { RegistryEntry };

export interface RegistryStore {
  getAll(): Promise<RegistryEntry[]>;
  appendMany(entries: RegistryEntry[]): Promise<void>;
}

const SEED: RegistryEntry[] = (seedJson as { entries: RegistryEntry[] }).entries ?? [];
const KV_KEY = "tile_registry";

// 새 엔트리를 name 기준으로 병합(업로드한 최신 RUID 로 덮어씀).
function merge(base: RegistryEntry[], add: RegistryEntry[]): RegistryEntry[] {
  const byName = new Map(base.map((e) => [e.name, e]));
  for (const e of add) if (e && e.name && e.ruid) byName.set(e.name, e);
  return [...byName.values()];
}

class MemoryStore implements RegistryStore {
  private data: RegistryEntry[] = [...SEED];
  async getAll() {
    return [...this.data]; // 복사 반환(KvStore 와 동일 계약 — 호출자 변형이 시드 오염 못 함)
  }
  async appendMany(entries: RegistryEntry[]) {
    this.data = merge(this.data, entries);
    // ⚠ serverless 에선 프로세스 간 공유/영속 안 됨 — 영속이 필요하면 KV 사용(getStore).
  }
}

// Vercel KV / Upstash Redis REST. 명령은 POST {url} body ["GET"|"SET", ...] (Authorization: Bearer).
class KvStore implements RegistryStore {
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
    const j = (await r.json()) as { result?: unknown };
    return j.result;
  }
  async getAll() {
    const raw = (await this.cmd(["GET", KV_KEY])) as string | null;
    if (!raw) {
      // 최초 호출: 시드로 초기화
      await this.cmd(["SET", KV_KEY, JSON.stringify(SEED)]);
      return [...SEED];
    }
    try {
      return JSON.parse(raw) as RegistryEntry[];
    } catch {
      return [...SEED];
    }
  }
  async appendMany(entries: RegistryEntry[]) {
    const cur = await this.getAll();
    const next = merge(cur, entries);
    await this.cmd(["SET", KV_KEY, JSON.stringify(next)]);
  }
}

type StoreKind = "kv" | "memory";
let _store: RegistryStore | null = null;
let _kind: StoreKind = "memory";

export function getStore(): RegistryStore {
  if (_store) return _store;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    _store = new KvStore(url, token);
    _kind = "kv";
  } else {
    _store = new MemoryStore();
    _kind = "memory";
  }
  return _store;
}

export function storeKind(): StoreKind {
  getStore(); // 선택을 확정(_kind 동기화)
  return _kind;
}
