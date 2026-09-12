// Minimal dependency-free PDF generator for POS reports.
// Uses built-in Type1 Courier fonts so PDFs work without font files or npm packages.
function ascii(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function plain(value) {
  return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
}
function fit(s, width, align='left') {
  s=plain(s);
  if (s.length > width) s = s.slice(0, Math.max(0,width-1)) + '~';
  if (align==='right') return s.padStart(width,' ');
  if (align==='center') { const left=Math.floor((width-s.length)/2); return ' '.repeat(Math.max(0,left))+s.padEnd(width-left,' '); }
  return s.padEnd(width,' ');
}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function num(n,d=3){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:d});}
function phDateTime(value) {
  if(!value)return '';
  const raw=String(value);
  if(!/[zZ]|[+-]\d\d:\d\d$/.test(raw))return raw.replace('T',' ').slice(0,19);
  const d=new Date(raw);if(Number.isNaN(d.getTime()))return raw.replace('T',' ').slice(0,19);
  return new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d).replace(',', '');
}
function wrap(text, width=84) {
  const out=[];
  for (const raw of String(text??'').split(/\r?\n/)) {
    if (!raw) { out.push(''); continue; }
    let line='';
    for (const word of plain(raw).split(/\s+/)) {
      if (!line) line=word;
      else if ((line+' '+word).length<=width) line+=' '+word;
      else { out.push(line); line=word; }
    }
    if(line) out.push(line);
  }
  return out;
}
function salesReportLines(report, title='Sales Report') {
  const lines=[];
  lines.push({text:title,bold:true});
  lines.push({text:`Period: ${String(report.period||'').toUpperCase()}    Date: ${report.target||''}`});
  lines.push({text:`Cashier: ${report.cashier||'ALL'}    Transactions: ${report.transactionCount||0}    Deleted: ${report.deletedCount||0}`});
  lines.push({text:''});
  lines.push({text:`Gross: PHP ${money(report.gross)}    Adjustment: PHP ${money(report.adjustment)}    Actual: PHP ${money(report.actual)}`,bold:true});
  lines.push({text:''});
  lines.push({text:'PRODUCT SUMMARY',bold:true});
  lines.push({text:fit('Product',24)+fit('Qty',7,'right')+fit('Gross',12,'right')+fit('Adjusted',12,'right')+fit('Actual',12,'right')+fit('Costing',12,'right')+fit('Net',12,'right')});
  lines.push({text:'-'.repeat(91)});
  for(const x of report.products||[]) lines.push({text:fit(x.name,24)+fit(num(x.qty,2),7,'right')+fit(money(x.gross),12,'right')+fit(money(x.adjusted),12,'right')+fit(money(x.actual),12,'right')+fit(money(x.costing),12,'right')+fit(money(x.net),12,'right')});
  if(!(report.products||[]).length) lines.push({text:'No product sales for this period.'});
  lines.push({text:''});
  lines.push({text:'PROMO BREAKDOWN',bold:true});
  lines.push({text:fit('Promo Name',30)+fit('Qty',8,'right')+fit('Gross',15,'right')+fit('Adjusted',15,'right')+fit('Actual',15,'right')});
  lines.push({text:'-'.repeat(83)});
  for(const x of report.promos||[]) lines.push({text:fit(x.name,30)+fit(num(x.qty,0),8,'right')+fit(money(x.gross),15,'right')+fit(money(x.adjustment),15,'right')+fit(money(x.actual),15,'right')});
  if(!(report.promos||[]).length) lines.push({text:'No promo purchases for this period.'});
  lines.push({text:''});
  lines.push({text:'TRANSACTIONS LOGS',bold:true});
  lines.push({text:fit('Reference',22)+fit('Cashier',12)+fit('Status',9)+fit('Date/Time',20)+fit('Actual',14,'right')});
  lines.push({text:'-'.repeat(77)});
  for(const x of report.transactions||[]) {
    lines.push({text:fit(x.reference,22)+fit(x.cashier||'',12)+fit(x.status||'',9)+fit(phDateTime(x.soldAt),20)+fit(money(x.actual),14,'right')});
    if(x.remark) for(const w of wrap(`  Remark: ${x.remark}`,80)) lines.push({text:w});
  }
  return lines;
}
function costingReportLines(report, title='Costing Report') {
  const lines=[];
  lines.push({text:title,bold:true});
  lines.push({text:`Period: ${String(report.period||'').toUpperCase()}    Date: ${report.target||''}    Cashier: ${report.cashier||'ALL'}`});
  lines.push({text:`Total ingredient cost: PHP ${money(report.totalCost)}    Ingredients used: ${(report.ingredients||[]).length}`,bold:true});
  lines.push({text:''});
  for(const ing of report.ingredients||[]) {
    lines.push({text:`Ingredient: ${plain(ing.name)} - Total Qty: ${num(ing.totalQty,6)} ${String(ing.uom||'').toUpperCase()} - Total Cost: PHP ${money(ing.totalCost)}`,bold:true});
    lines.push({text:fit('Product',35)+fit('Sold Qty',10,'right')+fit('Usage',14,'right')+fit('Cost/Item',14,'right')+fit('Total Cost',14,'right')});
    for(const d of ing.details||[]) lines.push({text:fit(d.product,35)+fit(num(d.productQty,3),10,'right')+fit(num(d.usageQty,6),14,'right')+fit(money(d.costPerItem),14,'right')+fit(money(d.totalCost),14,'right')});
    lines.push({text:''});
  }
  if(!(report.ingredients||[]).length) lines.push({text:'No costed product sales for this period.'});
  return lines;
}
function makePdf(lines, options={}) {
  const pageWidth=595.28,pageHeight=841.89,marginX=32,top=805,bottom=38,fontSize=8.4,leading=11;
  const usable=Math.floor((top-bottom)/leading);
  const pages=[];
  for(let i=0;i<lines.length;i+=usable) pages.push(lines.slice(i,i+usable));
  if(!pages.length) pages.push([{text:'No data.'}]);
  const objects=[];
  const add=o=>{objects.push(o);return objects.length;};
  const fontRegular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const fontBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
  const pageRefs=[];
  const pageData=[];
  // reserve pages tree after content/page object creation by using placeholder object now
  const pagesTree=add('PAGES_PLACEHOLDER');
  for(const pageLines of pages){
    let y=top;let stream='BT\n';
    for(const line of pageLines){
      const bold=!!line.bold;
      stream+=`/${bold?'F2':'F1'} ${fontSize} Tf\n1 0 0 1 ${marginX} ${y.toFixed(2)} Tm\n(${ascii(line.text)}) Tj\n`;
      y-=leading;
    }
    stream+='ET\n';
    const content=add(`<< /Length ${Buffer.byteLength(stream,'binary')} >>\nstream\n${stream}endstream`);
    const page=add(`<< /Type /Page /Parent ${pagesTree} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`);
    pageRefs.push(`${page} 0 R`);pageData.push(page);
  }
  objects[pagesTree-1]=`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.join(' ')}] >>`;
  const catalog=add(`<< /Type /Catalog /Pages ${pagesTree} 0 R >>`);
  const info=add(`<< /Title (${ascii(options.title||'Coffee POS Report')}) /Producer (Coffee POS Web) /CreationDate (D:${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}) >>`);
  let out='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(Buffer.byteLength(out,'binary'));
    out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=Buffer.byteLength(out,'binary');
  out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++) out+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  out+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out,'binary');
}
module.exports={makePdf,salesReportLines,costingReportLines,money,num,fit};
