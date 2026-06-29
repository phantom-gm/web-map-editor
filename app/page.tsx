"use client";

// 에디터는 전부 클라이언트(Canvas/Zustand/DOM). "use client" 경계에서 src/App 트리를 렌더.
import App from "../src/App";

export default function Page() {
  return <App />;
}
