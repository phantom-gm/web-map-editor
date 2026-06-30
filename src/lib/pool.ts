/**
 * 인덱스 0..count-1 을 제한 동시성으로 처리하는 워커 풀.
 * task(i) 를 동시에 최대 `concurrency` 개까지 실행한다. JS 단일스레드라 next++ 은 안전.
 * count=0 이면 즉시 resolve. task 가 던지면 Promise.all 이 reject 되므로 호출측에서 처리.
 */
export async function runPool(
  concurrency: number,
  count: number,
  task: (i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < count) await task(next++);
  };
  const workers = Math.min(Math.max(1, concurrency), count);
  await Promise.all(Array.from({ length: workers }, worker));
}
