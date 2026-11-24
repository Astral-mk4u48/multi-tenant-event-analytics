import { NextRequest } from "next/server";
import Redis from "ioredis";
import { resolveAuth } from "@/server/auth/guard";
import { env } from "@/server/env";
import { matchesEventPattern } from "@/server/webhooks/matcher";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/v1/events/stream
 * Server-Sent Events (SSE) Live Tail stream backed by Redis Pub/Sub scoped to tenant channel live:{org_id}.
 * Supports filters: ?event=payment.*&status=429
 * Unsubscribes and closes Redis subscriber immediately on client abort to prevent leaks.
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { searchParams } = new URL(req.url);
  const eventFilter = searchParams.get("event");
  const statusFilter = searchParams.get("status")
    ? parseInt(searchParams.get("status")!, 10)
    : null;

  const encoder = new TextEncoder();
  const channel = `live:{${auth.orgId}}`;

  let subClient: Redis | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        subClient = new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });

        subClient.on("error", (err) => {
          logger.warn({ err, orgId: auth.orgId }, "Live tail Redis subscriber error");
        });

        // 1. Subscribe strictly to tenant's Live Tail channel
        await subClient.subscribe(channel);
        logger.info({ orgId: auth.orgId, channel }, "Client connected to Live Tail SSE stream");

        // Send initial connected frame
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ status: "streaming", channel })}\n\n`)
        );

        // 2. Stream matching event frames
        subClient.on("message", (ch, message) => {
          if (ch !== channel || isClosed) return;

          try {
            const frame = JSON.parse(message);

            // Apply optional event name glob filter
            if (eventFilter && !matchesEventPattern(eventFilter, frame.event)) {
              return;
            }

            // Apply optional HTTP status code filter
            if (statusFilter !== null && frame.status !== statusFilter) {
              return;
            }

            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          } catch (err) {
            logger.warn({ err }, "Error processing Live Tail frame");
          }
        });

        // 3. Heartbeat comment frame every 15s to keep connections alive through proxies
        heartbeatInterval = setInterval(() => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            } catch {
              // Ignore enqueue errors if connection dropped
            }
          }
        }, 15000);
      } catch (err) {
        logger.error({ err, orgId: auth.orgId }, "Failed to start Live Tail SSE stream");
        cleanup();
        controller.error(err);
      }
    },
    cancel() {
      cleanup();
    },
  });

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (subClient) {
      subClient
        .unsubscribe(channel)
        .then(() => subClient?.quit())
        .catch(() => {})
        .finally(() => {
          subClient = null;
        });
      logger.info({ orgId: auth.orgId }, "Cleaned up and disconnected Live Tail SSE subscriber");
    }
  };

  req.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
