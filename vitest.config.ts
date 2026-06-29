import { defineConfig } from "vitest/config";

// 코어 로직(blueprintIO / registry / validate / iso) 단위테스트. Node 환경(파일 IO 사용).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
