import { Redis } from 'ioredis';

interface BenchmarkResult {
  userId: string;
  success: boolean;
  status: string | null;
  latencyMs: number;
}

async function runSeatHoldingBenchmark() {
  console.log('===============================================================');
  console.log('   SPIKE K-01: SEAT HOLDING MECHANISM BENCHMARK (REDIS ATOMIC)');
  console.log('===============================================================');

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    console.log(` Connected to Redis at ${redisHost}:${redisPort}`);

    const showtimeId = 'st_101';
    const seatId = 'A1';
    const holdKey = `hold:showtime:${showtimeId}:seat:${seatId}`;
    const ttlSeconds = 600; // 10 minutes TTL
    const concurrentRequests = 200;

    // 1. Reset state before running test
    await redis.del(holdKey);
    console.log(` Cleaned up key: "${holdKey}"`);
    console.log(` Preparing to launch ${concurrentRequests} concurrent seat-holding requests...`);
    console.log(` Target Command: SET ${holdKey} user_{i} EX ${ttlSeconds} NX\n`);

    // 2. Prepare 200 concurrent requests
    const tasks = Array.from({ length: concurrentRequests }, (_, i) => {
      const userId = `user_${(i + 1).toString().padStart(3, '0')}`;
      return async (): Promise<BenchmarkResult> => {
        const start = performance.now();
        // Redis Atomic Lock: SET key value EX 600 NX
        const status = await redis.set(holdKey, userId, 'EX', ttlSeconds, 'NX');
        const latencyMs = performance.now() - start;
        return {
          userId,
          success: status === 'OK',
          status,
          latencyMs,
        };
      };
    });

    // 3. Execute all 200 requests concurrently
    const overallStart = performance.now();
    const results = await Promise.all(tasks.map((task) => task()));
    const totalElapsedMs = performance.now() - overallStart;

    // 4. Analyze results
    const successfulRequests = results.filter((r) => r.success);
    const failedRequests = results.filter((r) => !r.success);

    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const minLatency = latencies[0];
    const maxLatency = latencies[latencies.length - 1];
    const avgLatency = latencies.reduce((acc, curr) => acc + curr, 0) / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    // 5. Inspect Redis state
    const currentHolder = await redis.get(holdKey);
    const remainingTTL = await redis.ttl(holdKey);

    // 6. Output formatted report to console
    console.log('---------------------------------------------------------------');
    console.log('                     BENCHMARK RESULTS                         ');
    console.log('---------------------------------------------------------------');
    console.log(`Total Concurrent Requests : ${concurrentRequests}`);
    console.log(`Total Elapsed Time        : ${totalElapsedMs.toFixed(2)} ms`);
    console.log(`Successful Holds (OK)     : ${successfulRequests.length} (Expected: 1)`);
    console.log(`Rejected Holds (null)     : ${failedRequests.length} (Expected: ${concurrentRequests - 1})`);
    console.log(`Winner User ID            : ${currentHolder}`);
    console.log(`Key Expiry TTL            : ${remainingTTL}s / ${ttlSeconds}s`);
    console.log('---------------------------------------------------------------');
    console.log('                     LATENCY METRICS (ms)                      ');
    console.log('---------------------------------------------------------------');
    console.log(`Min Latency               : ${minLatency.toFixed(3)} ms`);
    console.log(`Average Latency           : ${avgLatency.toFixed(3)} ms`);
    console.log(`50th Percentile (p50)     : ${p50.toFixed(3)} ms`);
    console.log(`95th Percentile (p95)     : ${p95.toFixed(3)} ms`);
    console.log(`99th Percentile (p99)     : ${p99.toFixed(3)} ms`);
    console.log(`Max Latency               : ${maxLatency.toFixed(3)} ms`);
    console.log('---------------------------------------------------------------');

    // 7. Assertions
    const isSingleWinner = successfulRequests.length === 1 && failedRequests.length === concurrentRequests - 1;
    const isWinnerMatching = currentHolder === successfulRequests[0]?.userId;
    const isTTLValid = remainingTTL > 0 && remainingTTL <= ttlSeconds;

    if (isSingleWinner && isWinnerMatching && isTTLValid) {
      console.log(' VERIFICATION PASSED:');
      console.log('  - Race-condition prevented: 100% (Single winner guaranteed).');
      console.log('  - Redis Atomic Lock (SET ... NX EX) validated successfully.');
      console.log('  - All rejected requests received "null" immediately without deadlock.');
      console.log('===============================================================\n');
    } else {
      console.error('❌ VERIFICATION FAILED!');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ Benchmark error:', error);
    process.exitCode = 1;
  } finally {
    await redis.quit();
  }
}

void runSeatHoldingBenchmark();
