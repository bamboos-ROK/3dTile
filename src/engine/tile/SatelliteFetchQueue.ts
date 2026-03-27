interface QueueItem {
  fn: () => Promise<Response>;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
}

export class SatelliteFetchQueue {
  private readonly queue: QueueItem[] = [];
  private running = 0;

  constructor(private readonly maxConcurrent = 6) {}

  fetch(url: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted before enqueue", "AbortError"));
        return;
      }

      const item: QueueItem = {
        fn: () => fetch(url, { ...init, signal }),
        resolve,
        reject,
        signal,
      };

      this.queue.push(item);

      signal?.addEventListener(
        "abort",
        () => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new DOMException("Queue item aborted", "AbortError"));
          }
          // 이미 실행 중이면 fetch() 자체가 signal을 보고 abort됨
        },
        { once: true },
      );

      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;

      // abort 이벤트와 drain 타이밍 race condition 방어
      if (item.signal?.aborted) {
        item.reject(new DOMException("Aborted before execution", "AbortError"));
        continue;
      }

      this.running++;
      item
        .fn()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}
