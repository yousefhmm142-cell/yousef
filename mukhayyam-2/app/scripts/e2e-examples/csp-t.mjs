// Serves the built app with the production security headers (like Cloudflare's _headers).
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
const root = '/tmp/m2-work/dist-t'
const csp = (await readFile('/tmp/m2-work/csp.txt', 'utf8')).replace("connect-src 'self'", "connect-src 'self' http://localhost:54321 ws://localhost:54321").replace('; upgrade-insecure-requests', '')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.apk': 'application/vnd.android.package-archive' }
createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = join(root, path)
  try { if (!(await stat(file)).isFile()) throw 0 } catch { file = join(root, 'index.html') }
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'content-security-policy': csp, 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
  })
  res.end(body)
}).listen(4175, () => console.log('csp server on 4175'))
