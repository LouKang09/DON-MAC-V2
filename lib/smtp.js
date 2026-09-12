const tls=require('tls');

function b64(s){return Buffer.from(String(s),'utf8').toString('base64');}
function cleanHeader(s){return String(s??'').replace(/[\r\n]+/g,' ').trim();}
function boundary(){return `----CoffeePOS_${Date.now()}_${Math.random().toString(16).slice(2)}`;}

function buildMessage({from,to,subject,text,attachments=[]}){
  const b=boundary();
  const headers=[
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(text||''),
    ''
  ];
  for(const a of attachments){
    const data=Buffer.isBuffer(a.data)?a.data:Buffer.from(a.data||'');
    const encoded=data.toString('base64').replace(/.{1,76}/g,'$&\r\n').trimEnd();
    headers.push(`--${b}`);
    headers.push(`Content-Type: ${a.contentType||'application/octet-stream'}; name="${cleanHeader(a.filename)}"`);
    headers.push('Content-Transfer-Encoding: base64');
    headers.push(`Content-Disposition: attachment; filename="${cleanHeader(a.filename)}"`);
    headers.push('');headers.push(encoded);headers.push('');
  }
  headers.push(`--${b}--`,'');
  return headers.join('\r\n');
}

async function sendMail(options){
  const host=options.host||'smtp.gmail.com';
  const port=Number(options.port||465);
  const user=String(options.user||'');
  const pass=String(options.pass||'');
  if(!user||!pass) throw new Error('SMTP_USER and SMTP_PASS are required for email delivery.');
  const to=String(options.to||'').trim();
  if(!to) throw new Error('A report recipient email is required.');
  const from=String(options.from||user).trim();
  const msg=buildMessage({...options,from,to});
  const socket=tls.connect({host,port,servername:host,rejectUnauthorized:true});
  socket.setTimeout(20000);
  let buffer='';
  const waiters=[];
  function pump(){
    while(waiters.length){
      const lines=buffer.split(/\r?\n/);
      let end=-1;
      for(let i=0;i<lines.length-1;i++) if(/^\d{3} /.test(lines[i])){end=i;break;}
      if(end<0)return;
      const consumed=lines.slice(0,end+1).join('\r\n');
      buffer=lines.slice(end+1).join('\r\n');
      waiters.shift().resolve(consumed);
    }
  }
  socket.on('data',d=>{buffer+=d.toString('utf8');pump();});
  socket.on('error',err=>{while(waiters.length)waiters.shift().reject(err);});
  socket.on('timeout',()=>socket.destroy(new Error('SMTP connection timed out.')));
  const read=()=>new Promise((resolve,reject)=>{waiters.push({resolve,reject});pump();});
  const command=async(cmd,expected=[250])=>{
    socket.write(cmd+'\r\n');
    const r=await read();const code=Number(r.slice(-3))||Number((r.match(/^(\d{3})/m)||[])[1]);
    if(!expected.includes(code)){const e=new Error(`SMTP error after ${cmd.split(' ')[0]}: ${r}`);e.smtpResponse=r;throw e;}return r;
  };
  try{
    await new Promise((resolve,reject)=>{socket.once('secureConnect',resolve);socket.once('error',reject);});
    let r=await read();if(!/^220/m.test(r))throw new Error(`SMTP connection rejected: ${r}`);
    await command(`EHLO ${options.helo||'coffee-pos.local'}`,[250]);
    await command('AUTH LOGIN',[334]);
    await command(b64(user),[334]);
    await command(b64(pass),[235]);
    await command(`MAIL FROM:<${from}>`,[250]);
    for(const addr of to.split(',').map(x=>x.trim()).filter(Boolean)) await command(`RCPT TO:<${addr}>`,[250,251]);
    await command('DATA',[354]);
    const dotStuffed=msg.replace(/(^|\r\n)\./g,'$1..');
    socket.write(dotStuffed+'\r\n.\r\n');
    r=await read();if(!/^250/m.test(r))throw new Error(`SMTP DATA rejected: ${r}`);
    try{await command('QUIT',[221]);}catch(_){}
    socket.end();
    return {ok:true,response:r};
  }catch(err){try{socket.destroy();}catch(_){}throw err;}
}
module.exports={sendMail,buildMessage};
