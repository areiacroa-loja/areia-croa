(function(root){
'use strict';
class PaymentFees {
 static defaults=Object.freeze({pix:0.01,credit_card:0.0499,fixed:0.99,yampi:0.025});
 static money(v){const n=Number(v);if(!Number.isFinite(n)||n<0)throw new Error('Informe um valor monetário válido.');return Math.round((n+Number.EPSILON)*100)/100;}
 static method(v){v=String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(v==='pix')return 'pix';if(['credit_card','cartao de credito','credito'].includes(v))return 'credit_card';return 'unknown';}
 // Gross includes buyer freight and interest. Interest is passed to the processor.
 static calculate({gross,interest=0,method,yampi=false,gateway=null}){
  gross=this.money(gross);interest=this.money(interest);if(interest>gross)throw new Error('Os juros não podem superar o total pago.');
  method=this.method(method);const known=method!=='unknown';
  gateway=gateway!==null?this.money(gateway):known&&gross>0?this.money(gross*this.defaults[method]+this.defaults.fixed):known?0:null;
  const commission=yampi?this.money(gross*this.defaults.yampi):0;
  return {gross,interest,method,gateway,yampi:commission,total:gateway===null?null:this.money(gateway+interest+commission),netGateway:gateway===null?null:this.money(gross-interest-gateway),netStore:gateway===null?null:this.money(gross-interest-gateway-commission),pending:gateway===null};
 }
 static fromCsv(r){const n=v=>this.money(Number(String(v||0).replace(',','.')));const base=this.money(n(r.total_venda)-n(r.desconto)+n(r.valor_frete));const interest=n(r.taxa_parcelamento),net=n(r.total_liquido);return this.calculate({gross:this.money(base+interest),interest,method:r.tipo_pagamento,yampi:true,gateway:this.money(base-net)});}
}
root.PaymentFees=PaymentFees;if(typeof module!=='undefined'&&module.exports)module.exports=PaymentFees;
})(typeof window!=='undefined'?window:globalThis);
