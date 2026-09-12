const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILE = path.join(ROOT,'data','runtime.json');
function loadEnvFile(file){
  if(!fs.existsSync(file))return;
  for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');if(i<1)continue;
    const key=line.slice(0,i).trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)||process.env[key]!==undefined)continue;
    let value=line.slice(i+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);process.env[key]=value;
  }
}
loadEnvFile(path.join(ROOT,'.env'));
const HOST = '127.0.0.1';
const START_PORT_RAW = Number(process.env.PORT || 3100);
const START_PORT = Number.isInteger(START_PORT_RAW)&&START_PORT_RAW>0&&START_PORT_RAW<65500?START_PORT_RAW:3100;
const [NODE_MAJOR,NODE_MINOR]=process.versions.node.split('.').map(Number);
if(NODE_MAJOR<22||(NODE_MAJOR===22&&NODE_MINOR<5)){console.error(`Node.js 22.5 or newer is required. Current version: ${process.versions.node}`);process.exit(1);}

function readRuntime(){
  try{return JSON.parse(fs.readFileSync(RUNTIME_FILE,'utf8'));}catch(_){return null;}
}
function probeHealth(port,timeout=1200){
  return new Promise(resolve=>{
    const req=http.get({host:HOST,port,path:'/api/health',timeout},res=>{
      let body='';res.on('data',d=>body+=d);res.on('end',()=>{
        try{const data=JSON.parse(body);resolve(res.statusCode===200&&data?.ok&&data?.app==='coffee-pos-web'?data:null);}catch(_){resolve(null);}
      });
    });
    req.on('error',()=>resolve(null));req.on('timeout',()=>{req.destroy();resolve(null);});
  });
}
async function existingPos(){
  const runtime=readRuntime();const port=Number(runtime?.port);
  if(!Number.isInteger(port)||port<=0||port>65535)return null;
  const health=await probeHealth(port);
  if(!health)return null;
  return {port,url:`http://${HOST}:${port}`,health};
}

function canUse(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.unref();
    s.once('error', () => resolve(false));
    s.listen({ host: HOST, port, exclusive: true }, () => s.close(() => resolve(true)));
  });
}

async function findPort() {
  for (let p = START_PORT; p < START_PORT + 50; p++) if (await canUse(p)) return p;
  throw new Error(`No free local port found between ${START_PORT} and ${START_PORT + 49}.`);
}

function waitForHealth(port) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      const req = http.get({ host: HOST, port, path: '/api/health', timeout: 1200 }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try{const data=JSON.parse(body);if(res.statusCode===200&&data?.ok&&data?.app==='coffee-pos-web')resolve(body);else retry();}
          catch(_){retry();}
        });
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (++tries >= 40) return reject(new Error('Coffee POS server did not become ready.'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

(async () => {
  const existing=await existingPos();
  if(existing){
    console.log('============================================================');
    console.log(' Coffee POS Web - Already Running');
    console.log('============================================================');
    console.log(`Using existing POS: ${existing.url}`);
    if(String(process.env.NO_BROWSER||'').toLowerCase()!=='true')openBrowser(existing.url);
    return;
  }
  try{fs.unlinkSync(RUNTIME_FILE);}catch(_){}
  const port = await findPort();
  const url = `http://${HOST}:${port}`;
  console.log('============================================================');
  console.log(' Coffee POS Web - Safe Start');
  console.log('============================================================');
  console.log(`Using local address: ${url}`);
  console.log('Keep this window OPEN while using the POS.');
  console.log('Press Ctrl+C here when you want to stop the POS.');
  console.log('');

  const child = spawn(process.execPath, ['--no-warnings','server.js'], {
    cwd: ROOT,
    env: { ...process.env, HOST, PORT: String(port), STRICT_PORT: 'true' },
    stdio: 'inherit'
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    try { child.kill('SIGINT'); } catch (_) {}
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  child.on('exit', code => {
    if (!stopping) {
      console.log('');
      console.log(`Coffee POS stopped${code ? ` with error code ${code}` : ''}.`);
      if (process.platform === 'win32') console.log('Press any key to close this window.');
      process.exitCode = code || 0;
    }
  });

  try {
    await waitForHealth(port);
    console.log(`POS is ready: ${url}`);
    if(String(process.env.NO_BROWSER||'').toLowerCase()!=='true') openBrowser(url);
  } catch (err) {
    console.error(err.message);
    try { child.kill('SIGINT'); } catch (_) {}
    process.exitCode = 1;
  }
})().catch(err => {
  console.error('Unable to start Coffee POS:', err.message);
  process.exit(1);
});
