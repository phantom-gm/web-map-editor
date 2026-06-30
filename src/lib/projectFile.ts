// 프로젝트 파일 저장/열기 — File System Access API(Chromium) 우선, 없으면 다운로드/파일인풋 폴백.
// FSA 가 있으면 "저장"이 같은 파일을 덮어쓰고(핸들 기억), 없으면 매번 다운로드된다.
import { downloadText } from "./blueprintIO";

// FSA 타입을 전역 재선언 없이 좁게 캡처(lib.dom 버전차 충돌 방지).
interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  name: string;
  createWritable(): Promise<WritableLike>;
  getFile(): Promise<File>;
}
interface PickerOpts {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}
type SavePicker = (o?: PickerOpts) => Promise<FileHandleLike>;
type OpenPicker = (o?: PickerOpts) => Promise<FileHandleLike[]>;

const win = typeof window !== "undefined" ? (window as unknown as { showSaveFilePicker?: SavePicker; showOpenFilePicker?: OpenPicker }) : undefined;
const JSON_TYPES = [{ description: "JSON", accept: { "application/json": [".json"] } }];

export const fsaAvailable = !!win?.showSaveFilePicker;

let handle: FileHandleLike | null = null;

export function currentFileName(): string | null {
  return handle?.name ?? null;
}
export function resetFileHandle(): void {
  handle = null;
}

/**
 * 프로젝트 저장. forceNew=true 면 항상 새 위치 선택(다른 이름으로 저장).
 * 반환: 저장된 파일명, 또는 null(사용자 취소).
 */
export async function saveProject(json: string, suggestedName: string, forceNew: boolean): Promise<string | null> {
  if (win?.showSaveFilePicker) {
    if (forceNew || !handle) {
      try {
        handle = await win.showSaveFilePicker({ suggestedName, types: JSON_TYPES });
      } catch {
        return null; // 사용자 취소
      }
    }
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    return handle.name;
  }
  // 폴백: 다운로드(같은 파일 덮어쓰기 불가).
  downloadText(suggestedName, json);
  return suggestedName;
}

/** FSA 로 프로젝트 열기. 반환: {text, name} 또는 null(취소). FSA 없으면 호출 금지(파일인풋 폴백 사용). */
export async function openProjectViaPicker(): Promise<{ text: string; name: string } | null> {
  if (!win?.showOpenFilePicker) return null;
  let h: FileHandleLike;
  try {
    [h] = await win.showOpenFilePicker({ types: JSON_TYPES });
  } catch {
    return null; // 취소
  }
  handle = h;
  const file = await h.getFile();
  return { text: await file.text(), name: file.name };
}
