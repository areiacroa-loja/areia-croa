const {test}=require('node:test');
const assert=require('node:assert/strict');
const crm=require('./clients-crm.js');
test('paid order identifies a buyer even when an old tag says abandoned cart',()=>{
  const result=crm.build({clientes:[{id:'a',nome:'Ana Lima',email:'ANA@example.test',tag:'carrinho_abandonado',created_at:'2026-09-01T15:00:00Z'}],pedidos:[{id:1,cliente_nome:'Ana Lima',cliente_email:'ana@example.test',receita:200,data:'2026-09-02',status:'pago'}],carrinhos:[{id:1,email:'ana@example.test',nome:'Ana Lima',data_criacao:'2026-09-01T16:00:00Z',recuperado:true,total:200}]});
  assert.equal(result.buyers.length,1);assert.equal(result.abandoned.length,0);assert.equal(result.buyers[0].total,200);
});
test('a returning buyer can also have a new open cart without losing purchase history',()=>{
  const r=crm.build({clientes:[{id:'a',nome:'Ana',telefone:'11999999999',created_at:'2026-08-01'}],pedidos:[{id:1,cliente_nome:'Ana',cliente_telefone:'5511999999999',status:'pago',receita:90,data:'2026-08-02'}],carrinhos:[{id:1,nome:'Ana',telefone:'11 99999-9999',total:120,data_criacao:'2026-10-01',recuperado:false}]});
  assert.equal(r.people.length,1);assert.equal(r.buyers.length,1);assert.equal(r.abandoned.length,1);assert.equal(r.abandoned[0].cartTotal,120);
});
test('checkout signup is not classified as an abandoned cart without evidence',()=>{
  const r=crm.build({clientes:[{id:'a',nome:'Lead',tag:'carrinho_abandonado',observacoes:'Yampi · cliente identificado no checkout'}]});
  assert.equal(r.abandoned.length,0);assert.equal(r.other.length,1);
});
test('cancelled and pending orders do not count as purchases; orders are deduplicated',()=>{
  const r=crm.build({pedidos:[{id:1,cliente_nome:'Ana',cliente_email:'a@example.test',status:'cancelado',receita:10},{id:2,cliente_nome:'Ana',cliente_email:'a@example.test',status:'pendente',receita:20},{id:3,cliente_nome:'Bea',cliente_email:'b@example.test',status:'pago',receita:30},{id:3,cliente_nome:'Bea',cliente_email:'b@example.test',status:'pago',receita:30}]});
  assert.equal(r.buyers.length,1);assert.equal(r.buyers[0].total,30);assert.equal(r.buyers[0].orders.length,1);
});
test('same name with conflicting emails is kept separate',()=>{
  const r=crm.build({clientes:[{id:'a',nome:'Maria Silva',email:'first@example.test'}],pedidos:[{id:1,cliente_nome:'Maria Silva',cliente_email:'second@example.test',receita:75,status:'pago'}]});
  assert.equal(r.people.length,2);assert.equal(r.buyers[0].emails[0],'second@example.test');
});
test('source dates take priority and missing dates remain at the end of both sort orders',()=>{
  const r=crm.build({clientes:[{id:'a',nome:'A',created_at:'2026-10-01',data_entrada_yampi:'2026-06-01'},{id:'b',nome:'B',created_at:'2026-08-01'},{id:'c',nome:'C'}]});
  assert.equal(r.people[0].entrySource,'Cadastro na Yampi');
  assert.deepEqual(crm.ordered(r.people).map(p=>p.nome),['B','A','C']);assert.deepEqual(crm.ordered(r.people,'oldest').map(p=>p.nome),['A','B','C']);
});
test('cart date is retained for unregistered leads and ignored carts never appear',()=>{
  const r=crm.build({carrinhos:[{id:1,nome:'Lead',email:'lead@example.test',data_criacao:'2026-09-03',total:50},{id:2,nome:'Lead',email:'lead@example.test',data_criacao:'2026-09-04',total:75},{id:3,nome:'Ignore',ignorado:true,total:900}]});
  assert.equal(r.abandoned.length,1);assert.equal(r.abandoned[0].entry,'2026-09-03');assert.equal(r.abandoned[0].cartTotal,125);assert.equal(r.abandoned[0].cart.id,2);
});
test('search matches accent-insensitive name, email and formatted phone',()=>{
  const r=crm.build({clientes:[{id:'a',nome:'João Santos',email:'joao@example.test',telefone:'11988887777'}]});
  assert.equal(crm.search(r.people,'joao').length,1);assert.equal(crm.search(r.people,'JOAO@EXAMPLE').length,1);assert.equal(crm.search(r.people,'(11) 98888-7777').length,1);
});
