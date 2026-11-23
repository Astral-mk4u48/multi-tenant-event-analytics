import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import crypto from "crypto";
import { ClickhouseAnalyticsClient } from "../src/server/analytics/clickhouse";

describe("v2 Issue #2: ClickHouse High-Velocity Analytics Rollup Suite", () => {
  let mockClickhouseServer: http.Server;
  let mockPort: number;
  let mockUrl: string;
  let client: ClickhouseAnalyticsClient;
  const testOrgId = crypto.randomUUID();

  beforeAll(async () => {
    // 1. Create a mock ClickHouse HTTP interface
    mockClickhouseServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${mockPort}`);
      const pathname = url.pathname;

      if (pathname === "/ping") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("Ok.\n");
      }

      // Collect body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString();
      const queryParam = url.searchParams.get("query") || body;

      if (queryParam.includes("CREATE TABLE")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("");
      }

      if (queryParam.includes("INSERT INTO")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("");
      }

      if (queryParam.includes("quantile(0.99)(latency_ms)")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            data: [
              {
                current_ingested: 150000,
                current_p99: 14.8,
              },
            ],
          })
        );
      }

      if (queryParam.includes("toStartOfHour(created_at)") || queryParam.includes("toStartOfMinute")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            data: [
              {
                bucket: new Date(Date.now() - 3600000).toISOString(),
                ingested: 75000,
                rate_limited: 240,
              },
              {
                bucket: new Date().toISOString(),
                ingested: 75000,
                rate_limited: 120,
              },
            ],
          })
        );
      }

      if (queryParam.includes("GROUP BY event_name")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            data: [
              { name: "payment.succeeded", count: 80000 },
              { name: "order.created", count: 50000 },
              { name: "user.signup", count: 20000 },
            ],
          })
        );
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
    });

    await new Promise<void>((resolve) => {
      mockClickhouseServer.listen(0, "127.0.0.1", () => {
        const addr = mockClickhouseServer.address();
        if (typeof addr === "object" && addr) {
          mockPort = addr.port;
          mockUrl = `http://127.0.0.1:${mockPort}`;
        }
        resolve();
      });
    });

    client = new ClickhouseAnalyticsClient();
    client.setUrl(mockUrl);
    client.setEnabled(true);
  });

  afterAll(async () => {
    if (mockClickhouseServer) {
      await new Promise<void>((resolve) => mockClickhouseServer.close(() => resolve()));
    }
  });

  it("checks ClickHouse health via /ping", async () => {
    const isHealthy = await client.checkHealth();
    expect(isHealthy).toBe(true);
  });

  it("initializes high-velocity analytics table schema", async () => {
    const ok = await client.initSchema();
    expect(ok).toBe(true);
  });

  it("inserts batched events formatted as JSONEachRow", async () => {
    const count = await client.insertEvents([
      {
        orgId: testOrgId,
        eventName: "payment.succeeded",
        statusCode: 202,
        latencyMs: 12.4,
        createdAt: new Date().toISOString(),
      },
      {
        orgId: testOrgId,
        eventName: "order.created",
        statusCode: 202,
        latencyMs: 8.9,
        createdAt: new Date().toISOString(),
      },
    ]);

    expect(count).toBe(2);
  });

  it("queries time-bucketed event rollups with sub-second analytical aggregations", async () => {
    const rollup = await client.queryRollups(testOrgId, "24h");
    expect(rollup).not.toBeNull();
    expect(rollup?.source).toBe("clickhouse");
    expect(rollup?.kpis.eventsIngested.value).toBe(150000);
    expect(rollup?.kpis.p99LatencyMs.value).toBe(14.8);
    expect(rollup?.volumeSeries.length).toBe(2);
    expect(rollup?.volumeSeries[0].ingested).toBe(75000);
    expect(rollup?.volumeSeries[0].rateLimited).toBe(240);
    expect(rollup?.topEventTypes.length).toBe(3);
    expect(rollup?.topEventTypes[0].name).toBe("payment.succeeded");
    expect(rollup?.topEventTypes[0].percent).toBeGreaterThan(0);
  });

  it("gracefully falls back when ClickHouse is disabled or unreachable", async () => {
    const disabledClient = new ClickhouseAnalyticsClient();
    disabledClient.setEnabled(false);

    expect(await disabledClient.checkHealth()).toBe(false);
    expect(await disabledClient.insertEvents([])).toBe(0);
    expect(await disabledClient.queryRollups(testOrgId)).toBeNull();

    const deadClient = new ClickhouseAnalyticsClient();
    deadClient.setUrl("http://127.0.0.1:1"); // unreachable port
    deadClient.setEnabled(true);

    expect(await deadClient.checkHealth()).toBe(false);
    expect(await deadClient.queryRollups(testOrgId)).toBeNull();
  });
});
