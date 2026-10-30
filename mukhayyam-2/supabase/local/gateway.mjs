// Local copy only: one address for the app, like a real Supabase project.
// /auth/v1/* goes to the sign-in service and /rest/v1/* to the data API.
import http from 'node:http'

export const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzYxODAwMDAwLCJleHAiOjIwNzcwMDAwMDB9.7gb1t2znGMZ5aWx8gA66v2MbXZLI0QTmX8OvzNBcZJE'

const routes = [
  ['/auth/v1', 54329],
  ['/rest/v1', 54330],
]
const port = Number(process.env.PORT ?? 54321)

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, range, x-supabase-api-version, accept',
  'access-control-expose-headers': 'content-range, x-total-count',
  'access-control-max-age': '600',
}

// Set OFFLINE=1 in the environment, or call /__offline?on=1, to make every request fail like a lost connection.
let offline = process.env.OFFLINE === '1'

http
  .createServer((req, res) => {
    if (req.url.startsWith('/__offline')) {
      offline = new URL(req.url, 'http://x').searchParams.get('on') === '1'
      res.writeHead(200, cors).end(String(offline))
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }
    if (offline) {
      req.socket.destroy()
      return
    }
    const route = routes.find(([prefix]) => req.url.startsWith(prefix + '/') || req.url === prefix)
    if (!route) {
      res.writeHead(404, cors).end('not found')
      return
    }
    const [prefix, target] = route
    const headers = { ...req.headers, host: `127.0.0.1:${target}` }
    const upstream = http.request(
      { host: '127.0.0.1', port: target, method: req.method, path: req.url.slice(prefix.length) || '/', headers },
      (up) => {
        const out = { ...up.headers }
        for (const k of Object.keys(out)) if (k.startsWith('access-control-')) delete out[k]
        res.writeHead(up.statusCode ?? 502, { ...out, ...cors })
        up.pipe(res)
      },
    )
    upstream.on('error', () => res.writeHead(502, cors).end('upstream down'))
    req.pipe(upstream)
  })
  .listen(port, () => console.log(`local Supabase gateway on http://localhost:${port}`))
