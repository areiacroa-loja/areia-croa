const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/erp-design.js','utf8');const start=source.indexOf('function acExpenseSummary(');const end=source.indexOf('(()=>{',start);const ctx={};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
test('cash outflows exclude canceled and only paid additional expenses reduce profit',()=>{
 const rows=[{data:'2026-11-01',valor:200,status:'pago',afeta_lucro:false},{data:'2026-11-02',valor:79.9,status:'pago',afeta_lucro:true},{data:'2026-11-03',valor:50,status:'pendente',afeta_lucro:true},{data:'2026-11-04',valor:99,status:'cancelado',afeta_lucro:true},{data:'2026-10-01',valor:10,status:'pago',afeta_lucro:true}];const r=ctx.acExpenseSummary(rows,'2026-11');assert.equal(r.paid,279.9);assert.equal(r.pending,50);assert.equal(r.operating,79.9);assert.equal(r.count,3);assert.equal(ctx.acExpenseSummary(rows).operating,89.9);
});
test('decimal expense totals are added in cents',()=>{assert.equal(ctx.acExpenseSummary([{status:'pago',valor:.1},{status:'pago',valor:.2}]).paid,.3);});
