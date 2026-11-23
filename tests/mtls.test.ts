import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "https";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { NextRequest } from "next/server";
import { migrationPool } from "../src/db";
import { sendOutboundWebhook } from "../src/server/webhooks/sender";
import { signSession } from "../src/server/auth/session";
import { POST as handleCreateWebhook, GET as handleListWebhooks } from "../src/app/api/v1/webhooks/route";

describe("v2 Issue #3: Enterprise mTLS Client Certificates Suite", () => {
  let tmpDir: string;
  let caCert: string;
  let serverCert: string;
  let serverKey: string;
  let clientCert: string;
  let clientKey: string;
  let httpsServer: https.Server;
  let httpsPort: number;
  let httpsUrl: string;

  let testOrgId: string;
  let adminSessionCookie: string;

  beforeAll(async () => {
    process.env.ALLOW_TEST_LOOPBACK = "true";

    // 1. Generate real ephemeral CA, Server, and Client TLS certificates via OpenSSL
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mtls-test-"));
    const caKeyPath = path.join(tmpDir, "ca.key");
    const caCertPath = path.join(tmpDir, "ca.crt");
    const serverKeyPath = path.join(tmpDir, "server.key");
    const serverCsrPath = path.join(tmpDir, "server.csr");
    const serverCertPath = path.join(tmpDir, "server.crt");
    const clientKeyPath = path.join(tmpDir, "client.key");
    const clientCsrPath = path.join(tmpDir, "client.csr");
    const clientCertPath = path.join(tmpDir, "client.crt");

    // CA
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${caKeyPath}" -out "${caCertPath}" -days 1 -subj "/CN=TestWebhookCA"`
    );

    // Server Cert with SAN=127.0.0.1
    const extFile = path.join(tmpDir, "server.ext");
    fs.writeFileSync(extFile, "subjectAltName=IP:127.0.0.1,DNS:localhost\n");
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout "${serverKeyPath}" -out "${serverCsrPath}" -subj "/CN=localhost"`
    );
    execSync(
      `openssl x509 -req -in "${serverCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${serverCertPath}" -days 1 -extfile "${extFile}"`
    );

    // Client Cert signed by same CA
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout "${clientKeyPath}" -out "${clientCsrPath}" -subj "/CN=EnterpriseClient"`
    );
    execSync(
      `openssl x509 -req -in "${clientCsrPath}" -CA "${caCertPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${clientCertPath}" -days 1`
    );

    caCert = fs.readFileSync(caCertPath, "utf8");
    serverCert = fs.readFileSync(serverCertPath, "utf8");
    serverKey = fs.readFileSync(serverKeyPath, "utf8");
    clientCert = fs.readFileSync(clientCertPath, "utf8");
    clientKey = fs.readFileSync(clientKeyPath, "utf8");

    // 2. Start mock HTTPS server strictly demanding valid client certificates (mTLS)
    httpsServer = https.createServer(
      {
        key: serverKey,
        cert: serverCert,
        ca: caCert,
        requestCert: true,
        rejectUnauthorized: true, // TLS handshake fails if client does not present valid cert
      },
      (req, res) => {
        const clientCertPresented = (req.socket as import("tls").TLSSocket).getPeerCertificate();
        if (clientCertPresented && clientCertPresented.subject) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ authenticated: true, subject: clientCertPresented.subject }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Client certificate missing or untrusted" }));
        }
      }
    );

    await new Promise<void>((resolve) => {
      httpsServer.listen(0, "127.0.0.1", () => {
        const addr = httpsServer.address();
        if (typeof addr === "object" && addr) {
          httpsPort = addr.port;
          httpsUrl = `https://127.0.0.1:${httpsPort}`;
        }
        resolve();
      });
    });

    testOrgId = crypto.randomUUID();
    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 6000)`,
      [testOrgId, `org-mtls-${Date.now()}`, "mTLS Test Org"]
    );

    adminSessionCookie = signSession({
      userId: crypto.randomUUID(),
      orgId: testOrgId,
      role: "ADMIN",
      email: "admin@mtls.internal",
      name: "Admin User",
    });
  });

  afterAll(async () => {
    if (httpsServer) {
      await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dispatches outbound webhook with mTLS client certificate and succeeds (200 OK)", async () => {
    const deliveryId = `dlv_mtls_ok_${Date.now()}`;
    const result = await sendOutboundWebhook({
      deliveryId,
      endpointUrl: `${httpsUrl}/webhook`,
      rawJsonBody: JSON.stringify({ event: "invoice.paid" }),
      signingSecret: "whsec_testmtls0123456789abcdef",
      allowLoopback: true,
      tlsConfig: {
        clientCert,
        clientKey,
        caCert,
      },
    });

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.responseBody);
    expect(body.authenticated).toBe(true);
    expect(body.subject.CN).toBe("EnterpriseClient");
  });

  it("fails TLS handshake when outbound webhook omits required client certificate", async () => {
    const deliveryId = `dlv_mtls_fail_${Date.now()}`;
    const result = await sendOutboundWebhook({
      deliveryId,
      endpointUrl: `${httpsUrl}/webhook`,
      rawJsonBody: JSON.stringify({ event: "invoice.paid" }),
      signingSecret: "whsec_testmtls0123456789abcdef",
      allowLoopback: true,
      tlsConfig: {
        caCert, // server CA provided so server is trusted, but NO client cert/key
      },
    });

    // Connection aborted or handshake rejected by server
    expect(result.statusCode).toBeNull();
    expect(result.error).toBeDefined();
  });

  it("rejects configuring mTLS client certificates on insecure HTTP URLs", async () => {
    const deliveryId = `dlv_http_mtls_${Date.now()}`;
    const result = await sendOutboundWebhook({
      deliveryId,
      endpointUrl: "http://127.0.0.1:8080/insecure",
      rawJsonBody: JSON.stringify({ event: "test" }),
      signingSecret: "whsec_testmtls0123456789abcdef",
      allowLoopback: true,
      tlsConfig: {
        clientCert,
        clientKey,
      },
    });

    expect(result.statusCode).toBeNull();
    expect(result.error).toContain("mTLS client certificates can only be configured with HTTPS");
  });

  it("persists mTLS certificates via POST /api/v1/webhooks and never leaks private key in GET", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `session_token=${adminSessionCookie}`,
      },
      body: JSON.stringify({
        url: "https://secure-api.internal/webhooks",
        events: ["payment.*"],
        mtls_enabled: true,
        tls_client_cert: clientCert,
        tls_client_key: clientKey,
        tls_ca_cert: caCert,
      }),
    });

    const createRes = await handleCreateWebhook(createReq);
    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    const epId = createJson.endpoint.id;
    expect(epId).toBeDefined();
    expect(createJson.endpoint.mtls_enabled).toBe(true);

    // Verify raw private key is encrypted in database
    const dbRow = await migrationPool.query(
      "SELECT tls_client_key FROM webhook_endpoints WHERE id = $1",
      [epId]
    );
    expect(dbRow.rows[0].tls_client_key).not.toBe(clientKey);
    expect(dbRow.rows[0].tls_client_key).toContain(":"); // iv:authTag:ciphertext

    // Verify GET /api/v1/webhooks masks/omits private key
    const listReq = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      headers: {
        Cookie: `session_token=${adminSessionCookie}`,
      },
    });
    const listRes = await handleListWebhooks(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    const ep = listJson.data.find((e: { id: string }) => e.id === epId);
    expect(ep).toBeDefined();
    expect(ep.mtls_enabled).toBe(true);
    expect(ep.has_client_cert).toBe(true);
    expect(ep.tls_client_key).toBeUndefined();
  });
});
