const {test}=require('node:test');
const assert=require('node:assert/strict');
const Fees=require('./payment-fees');
test('Pix includes fixed fee once per order',()=>{const f=Fees.calculate({gross:166.25,method:'Pix',yampi:true});assert.equal(f.gateway,2.65);assert.equal(f.yampi,4.16);assert.equal(f.total,6.81);assert.equal(f.netGateway,163.60);});
test('6 installments reconcile gateway, interest and Yampi',()=>{const f=Fees.calculate({gross:180.17,interest:23.42,method:'Cartão de Crédito',yampi:true});assert.equal(f.gateway,9.98);assert.equal(f.yampi,4.50);assert.equal(f.netGateway,146.77);assert.equal(f.netStore,142.27);assert.equal(f.total,37.90);});
test('CSV preserves reported rounding',()=>{const f=Fees.fromCsv({total_venda:'175,00',desconto:'3,50',valor_frete:'0',taxa_parcelamento:'0',total_liquido:'168,80',tipo_pagamento:'Pix'});assert.equal(f.gateway,2.70);assert.equal(f.netGateway,168.80);});
test('unknown payment remains pending',()=>{const f=Fees.calculate({gross:100,method:'boleto',yampi:true});assert.equal(f.gateway,null);assert.equal(f.total,null);assert.equal(f.yampi,2.50);});
test('other channels have no Yampi commission',()=>{assert.equal(Fees.calculate({gross:100,method:'pix'}).yampi,0);});
test('zero and invalid boundaries',()=>{assert.equal(Fees.calculate({gross:0,method:'pix',yampi:true}).total,0);assert.throws(()=>Fees.calculate({gross:-1}));assert.throws(()=>Fees.calculate({gross:100,interest:101}));assert.throws(()=>Fees.calculate({gross:NaN}));});
