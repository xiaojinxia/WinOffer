import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Store } from './store.js';
import { createAppServer } from './http.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 至 65535 的整数');
const dataDirectory = process.env.WINOFFER_DATA_DIR ? resolve(process.env.WINOFFER_DATA_DIR) : resolve(root, 'data');
const store = new Store(resolve(dataDirectory, 'winoffer.sqlite'));
const server = createAppServer(store);
const url = `http://127.0.0.1:${port}/`;
function openBrowser() {
  let browser;
  if (process.platform === 'win32') browser = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`Start-Process '${url}'`], { windowsHide:true, stdio:'ignore' });
  else if (process.platform === 'darwin') browser = spawn('/usr/bin/open', [url], { stdio:'ignore' });
  browser?.on('error', () => console.log(`Please open ${url} in your browser.`));
}
server.on('error', async error => {
  store.close();
  if (error.code === 'EADDRINUSE') {
    try {
      const health = await fetch(`${url}api/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
      if (health.app === 'winoffer') { console.log(`WinOffer is already running: ${url}`); if (process.argv.includes('--open')) openBrowser(); return; }
    } catch {}
    console.error(`Port ${port} is in use by another program. Set PORT to another port and restart.`);
  } else console.error(error);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`WinOffer: ${url}\nData: ${dataDirectory}\nAll saved changes persist locally. Press Ctrl+C to stop.`);
  if (process.argv.includes('--open')) openBrowser();
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
