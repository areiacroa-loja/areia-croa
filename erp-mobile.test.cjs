const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const full=fs.readFileSync(__dirname+'/erp-design.js','utf8');const source=full.slice(full.indexOf('/* Mobile dialogs use one scroll surface'));
function setup(){
 const observers=[],listeners={},calls=[];const classes=()=>{const items=new Set();return {add:n=>items.add(n),remove:n=>items.delete(n),contains:n=>items.has(n)}};
 const style=()=>{const values=new Map();return {setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k),get:k=>values.get(k)}};
 const element=()=>({classList:classes(),style:style(),attributes:{},setAttribute(k,v){this.attributes[k]=v},getClientRects:()=>[{}],isConnected:true,focus(){calls.push('focus')}});
 const body=element(),html=element(),box=element(),trigger=element(),button=element(),overlay=element();overlay.id='modal-item';overlay.classList.add('hidden');box.querySelector=()=>({textContent:'Editar pedido'});
 overlay.querySelector=selector=>selector==='.modal-close'?button:box;overlay.querySelectorAll=()=>[button];
 const fire=()=>observers.filter(o=>o.target===overlay).forEach(o=>o.callback());button.click=()=>{calls.push('close');overlay.classList.add('hidden');fire()};
 const document={body,documentElement:html,readyState:'complete',activeElement:trigger,querySelector:()=>null,getElementById:()=>null,querySelectorAll:selector=>selector==='.modal-overlay,#drawer-overlay'?[overlay]:[],addEventListener:(name,fn)=>listeners[name]=fn};
 const window={scrollY:415,innerHeight:800,visualViewport:{height:800,scale:1,addEventListener(){}},addEventListener(){},scrollTo:(x,y)=>calls.push(['scroll',x,y])};
 const context=vm.createContext({document,window,matchMedia:()=>({matches:true,addEventListener(){}}),getComputedStyle:e=>({display:e.classList.contains('hidden')?'none':'flex'}),requestAnimationFrame:fn=>fn(),MutationObserver:class{constructor(callback){this.callback=callback}observe(target){this.target=target;observers.push(this)}}});
 vm.runInContext(source,context);return {body,html,overlay,box,calls,listeners,open(){overlay.classList.remove('hidden');fire()},close(){button.click()}};
}
test('mobile dialog locks the background and restores its exact scroll position',()=>{const app=setup();app.open();assert.equal(app.body.classList.contains('ac-overlay-open'),true);assert.equal(app.body.style.get('--ac-scroll-top'),'-415px');assert.equal(app.box.attributes.role,'dialog');assert.equal(app.box.attributes['aria-modal'],'true');app.close();assert.equal(app.body.classList.contains('ac-overlay-open'),false);assert.equal(app.html.classList.contains('ac-overlay-open'),false);assert.deepEqual(app.calls.find(Array.isArray),['scroll',0,415]);assert.equal(app.body.style.get('--ac-scroll-top'),undefined)});
test('Escape closes through the original dialog action and releases the page',()=>{const app=setup();app.open();let prevented=false;app.listeners.keydown({key:'Escape',preventDefault(){prevented=true}});assert.equal(prevented,true);assert.equal(app.calls.includes('close'),true);assert.equal(app.body.classList.contains('ac-overlay-open'),false)});

test('choosing a menu page starts at the top instead of restoring the previous page scroll',()=>{const app=setup();app.overlay.id='drawer-overlay';app.open();app.listeners.click({target:{closest:()=>({})}});app.close();assert.deepEqual(app.calls.find(Array.isArray),['scroll',0,0]);assert.equal(app.body.classList.contains('ac-overlay-open'),false)});
