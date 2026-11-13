const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(__dirname+'/erp-traffic.js','utf8'),c);
test('campaign attribution keeps missing and ambiguous UTMs unassigned',()=>{
 const result=c.window.acCampaignAttribution([
  {utm_campaign:'123456789012345',receita:100},{utm_campaign:'Promo',receita:50},
  {utm_campaign:'duplicada',receita:300},{receita:200},{utm_campaign:'12345678901234',receita:90},
 ],[{campaign_id:'123456789012345',campaign_name:'Promo'},{campaign_id:'2',campaign_name:'duplicada'},{campaign_id:'3',campaign_name:'duplicada'}]);
 assert.equal(result.matched.length,1);assert.equal(result.matched[0].orders,2);assert.equal(result.matched[0].revenue,150);assert.equal(result.unmatched.length,3);
});
test('historical original campaign in notes can be recovered without fuzzy matching',()=>{
 const result=c.window.acCampaignAttribution([{observacoes:'Yampi order_id=10 · source=meta | campaign=campanha original | content=anuncio',receita:20}],[{campaign_id:'4',campaign_name:'campanha original'}]);
 assert.equal(result.matched[0].revenue,20);
});
