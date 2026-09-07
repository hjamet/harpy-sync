#!/usr/bin/env node

import { HarpyMcpServer } from "./server.js";
import { WS_BRIDGE_PORT, WS_BRIDGE_HOST } from "@harpy/core";

// Parse optional port / host from CLI arguments or environment
const port = parseInt(process.env.HARPY_WS_PORT || "", 10) || WS_BRIDGE_PORT;
const host = process.env.HARPY_WS_HOST || WS_BRIDGE_HOST;

const server = new HarpyMcpServer({
  wsPort: port,
  wsHost: host,
  name: "harpy-mcp-server",
  version: "0.1.0"
});

// Setup graceful shutdown
const handleSignal = async (signal: string) => {
  console.error(`[Harpy-MCP] Received ${signal}, shutting down gracefully...`);
  try {
    await server.stop();
    process.exit(0);
  } catch (err) {
    console.error("[Harpy-MCP] Error during shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

// Global error handlers
process.on("uncaughtException", (err: any) => {
  console.error("[Harpy-MCP] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason: any) => {
  console.error("[Harpy-MCP] Unhandled Rejection:", reason);
});

// Launch server
server.start().catch((err) => {
  console.error("[Harpy-MCP] Fatal error starting server:", err);
  process.exit(1);
});
