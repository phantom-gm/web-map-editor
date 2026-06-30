import { useState } from "react";

/**
 * 정수 입력 필드. 편집 중에는 빈칸/중간값을 그대로 허용하고,
 * 포커스를 벗어나거나 Enter 시점에만 [min, max]로 보정해 커밋한다.
 * (값이 즉시 min 으로 튕겨 수정이 불편한 문제를 방지)
 */
export function NumberField({
  value,
  min,
  max,
  step = 1,
  className = "num",
  onCommit,
}: {
  value: number;
  min: number;
  max?: number;
  step?: number;
  className?: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // 외부(스토어) 값이 바뀌면 입력칸을 동기화 — 렌더 중 보정(effect 불필요).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }

  const commit = () => {
    const n = parseInt(text, 10);
    let v = Number.isFinite(n) ? n : value; // 빈칸/숫자아님 → 이전 값 유지
    v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(String(v)); // 보정값으로 표시 동기화
    if (v !== value) onCommit(v);
  };

  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
