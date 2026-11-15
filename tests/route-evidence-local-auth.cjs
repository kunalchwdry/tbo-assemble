// LOCAL TEST DOUBLE ONLY. This server DOES NOT VERIFY JWT SIGNATURES.
// Never expose it to a network, and never configure a real deployment to use it.
const http = require('node:http');
const users = new Set(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  let id = '';
  try { id = JSON.parse(Buffer.from((req.headers.authorization || '').replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub; } catch {}
  if (req.url === '/auth/v1/user' && users.has(id)) {
    res.end(JSON.stringify({ id, aud: 'authenticated', role: 'authenticated', email: 'local-test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }));
  } else {
    res.statusCode = 401;
    res.end(JSON.stringify({ message: 'Invalid local test session' }));
  }
}).listen(54329, '127.0.0.1', () => console.log('Local fake auth listening on 127.0.0.1:54329'));
