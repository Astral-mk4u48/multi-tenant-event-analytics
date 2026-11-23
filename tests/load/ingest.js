import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

/**
 * High-Throughput Ingestion Load Test
 *
 * Benchmarks POST /api/v1/events throughput, rate limiter responsiveness, and p99 latency.
 *
 * Usage:
 *   k6 run tests/load/ingest.js
 * Or via Docker:
 *   docker run --rm -i --network=host grafana/k6 run - < tests/load/ingest.js
 */

const IngestionSuccessRate = new Rate("ingestion_success_rate");
const RateLimitedCounter = new Counter("rate_limited_count");
const IngestionLatency = new Trend("ingestion_p99_latency_ms");

export const options = {
  stages: [
    { duration: "10s", target: 50 },  // Ramp-up to 50 virtual users
    { duration: "30s", target: 150 }, // Sustain 150 VUs (testing 6,000 RPM window)
    { duration: "10s", target: 0 },   // Graceful ramp-down
  ],
  thresholds: {
    http_req_duration: ["p(95)<150", "p(99)<250"], // Target p99 latency <= 250ms
    ingestion_success_rate: ["rate>0.90"],          // At least 90% accepted (rest rate-limited)
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:3000";
const API_KEY = __ENV.API_KEY || "pk_live_acme_ingest_test_key_sample";

const EVENT_NAMES = [
  "payment.succeeded",
  "invoice.paid",
  "user.signup",
  "subscription.renewed",
  "session.started",
];

export default function () {
  const eventName = EVENT_NAMES[Math.floor(Math.random() * EVENT_NAMES.length)];
  const idempotencyKey = `load_${__VU}_${__ITER}_${Date.now()}`;

  const payload = JSON.stringify({
    event: eventName,
    data: {
      user_id: `usr_${__VU}_${__ITER}`,
      amount_cents: Math.floor(Math.random() * 50000) + 1000,
      currency: "usd",
      source: "k6-load-runner",
      timestamp: new Date().toISOString(),
    },
    idempotency_key: idempotencyKey,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/events`, payload, params);
  const duration = Date.now() - startTime;

  IngestionLatency.add(duration);

  const isAccepted = res.status === 202;
  const isRateLimited = res.status === 429;

  IngestionSuccessRate.add(isAccepted);
  if (isRateLimited) {
    RateLimitedCounter.add(1);
  }

  check(res, {
    "status is 202 Accepted or 429 Rate Limited": (r) => r.status === 202 || r.status === 429,
    "has X-RateLimit headers": (r) => r.headers["X-Ratelimit-Limit"] !== undefined,
  });

  sleep(0.05); // 50ms pacing between requests per VU
}
