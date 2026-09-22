import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AppError, validateBackup } from '../shared/model.js';

const assets = new Map([
  ['/', new URL('../public/index.html', import.meta.url)],
  ...['app.js','views.js','icons.js','styles.css','mark.svg'].map(name => [`/${name}`, new URL(`../public/${name}`, import.meta.url)]),
  ['/model.js', new URL('../shared/model.js', import.meta.url)],
]);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml' };
const MAX_BODY = 64 * 1024 * 1024;
function json(res, value, status = 200, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value)); }
async function body(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new AppError('请使用 JSON 格式提交', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError('文件过大，最多支持 64 MB', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('文件内容不是有效的 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('提交内容应为 JSON 对象');
  return value;
}
export function createAppServer(store) {
  return createServer(async (req,res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new AppError('只允许从本机访问', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new AppError('不允许跨站访问本地数据', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('不允许跨站访问本地数据', 403);
      const path = new URL(req.url, `http://${host}`).pathname;
      if (path === '/api/health' && req.method === 'GET') return json(res, { app: 'winoffer', version: '1.0.0' });
      if (path === '/api/state' && req.method === 'GET') return json(res, store.snapshot());
      if (path === '/api/records' && req.method === 'POST') { const data = await body(req); return json(res, store.create(data.record, data.revision), 201); }
      if (/^\/api\/records\/[\w-]+$/.test(path) && req.method === 'PATCH') { const data = await body(req); return json(res, store.change(path.split('/').at(-1), data.change, data.revision)); }
      if (/^\/api\/records\/[\w-]+$/.test(path) && req.method === 'DELETE') { const data = await body(req); return json(res, store.remove(path.split('/').at(-1), data.revision)); }
      if (path === '/api/backup' && req.method === 'GET') return json(res, store.export(), 200, { 'Content-Disposition': `attachment; filename="winoffer-${new Date().toISOString().slice(0,10)}.json"` });
      if (path === '/api/backups' && req.method === 'GET') return json(res, { files: store.backups() });
      if (path.startsWith('/api/backups/') && req.method === 'GET') return json(res, store.readBackup(decodeURIComponent(path.slice('/api/backups/'.length))));
      if (path === '/api/restore/preview' && req.method === 'POST') {
        const data = await body(req), backup = validateBackup(data.backup);
        return json(res, { count: backup.records.length, exportedAt: backup.exportedAt, companies: backup.records.slice(0, 5).map(r => r.company) });
      }
      if (path === '/api/restore' && req.method === 'POST') { const data = await body(req); return json(res, store.restore(data.backup, data.revision)); }
      if (path === '/prototype' || path === '/prototype/') { res.writeHead(302, { Location: '/' }); return res.end(); }
      if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      const asset = assets.get(path);
      if (asset && ['GET','HEAD'].includes(req.method)) {
        const content = await readFile(asset);
        res.writeHead(200, { 'Content-Type': types[fileURLToPath(asset).split('.').at(-1)] });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      throw new AppError('未找到该页面或操作', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error('WinOffer request failed:', error);
      if (!res.headersSent) json(res, { error: status === 500 ? '保存或读取失败，请检查磁盘空间和本地服务后重试。当前页面中的编辑内容仍保留。' : error.message }, status);
      else res.end();
    }
  });
}
