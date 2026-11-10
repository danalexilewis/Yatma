/** Serve a browser storage reset only from a local, non-production Metro server. */
function withDevelopmentStorageReset(middleware) {
  return function developmentStorageReset(req, res, next) {
    if (req.url !== "/_yatma/dev/reset-storage") return middleware(req, res, next);

    const address = req.socket.remoteAddress;
    const localAddress =
      address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host ?? "");
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://${req.headers.host}`;
    if (process.env.NODE_ENV === "production" || !localAddress || !localHost || !sameOrigin) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method !== "POST" || req.headers["x-yatma-development-reset"] !== "1") {
      res.writeHead(405, { Allow: "POST" });
      res.end();
      return;
    }

    // The browser clears this origin's databases; the app and Worker expose no reset command.
    res.writeHead(200, {
      "Clear-Site-Data": '"storage"',
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ reset: true }));
  };
}

module.exports = { withDevelopmentStorageReset };
