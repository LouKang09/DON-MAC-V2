'use strict';
// One-time, narrowly scoped cleanup of the four original demonstration promotions.
// Never delete receipts or inventory history; only archive named promo catalog rows.
// Preserve Christmas Treats and every other promotion the owner added.
const OBSOLETE=['143 Promo','Waffle + 2Coffee','Fries + Coffee','Waffle Fries Combo'];
const RECENT='Christmas Treats';
async function run(db){
 const old=OBSOLETE.map(x=>x.toLowerCase());
 const legacy=await db.query(
  'UPDATE promos SET active=$1 WHERE active=$2 AND LOWER(TRIM(name)) IN ($3,$4,$5,$6) '+
  'AND EXISTS (SELECT 1 FROM promos newer WHERE LOWER(TRIM(newer.name))=$7 AND newer.active=$8)',
  [false,true,...old,RECENT.toLowerCase(),true]);
 const branch=await db.query(
  'UPDATE branch_promos SET active=$1,updated_at=CURRENT_TIMESTAMP '+
  'WHERE active=$2 AND LOWER(TRIM(name)) IN ($3,$4,$5,$6) '+
  'AND EXISTS(SELECT 1 FROM branch_promos newer '+
  'WHERE newer.workspace_id=branch_promos.workspace_id '+
  'AND newer.branch_id=branch_promos.branch_id '+
  'AND LOWER(TRIM(newer.name))=$7 AND newer.active=$8)',
  [false,true,...old,RECENT.toLowerCase(),true]);
 return{legacyArchived:legacy.rowCount||0,branchArchived:branch.rowCount||0,
  retainedPromotion:RECENT,deletedSales:0};
}
module.exports={run};
