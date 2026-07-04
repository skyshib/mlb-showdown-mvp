#!/usr/bin/env node
import { createOnlineServer } from "./online-server.js";

// Same server as `npm run online`, on the classic dev port: static files plus
// the online-rooms API, so "Create online room" works regardless of which
// script started the app.
// Accepts the port as env PORT or a numeric CLI arg (old callers passed a
// root path first, so pick the first numeric value).
const port = [process.env.PORT, process.argv[2], process.argv[3]]
  .map(Number)
  .find((value) => Number.isFinite(value) && value > 0) ?? 5177;

const { server } = createOnlineServer();
server.listen(port, () => {
  console.log(`Serving http://127.0.0.1:${port}/index.html (online rooms enabled, no-store caching)`);
});
