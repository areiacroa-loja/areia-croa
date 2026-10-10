(() => {
  const screen=document.getElementById('login-screen');
  if(!screen || screen.querySelector('.ac-photo-mosaic'))return;
  const photos=Array.from({length:16},(_,i)=>`login-photo-${String(i+1).padStart(2,'0')}.webp`);
  const mosaic=document.createElement('div');mosaic.className='ac-photo-mosaic';mosaic.setAttribute('aria-hidden','true');
  const tiles=photos.slice(0,12).map((src,i)=>{
    const tile=document.createElement('div');tile.className='ac-photo-tile';
    const image=new Image();image.src=src;image.alt='';image.decoding='async';image.draggable=false;
    tile.append(image);mosaic.append(tile);return {tile,image,index:i};
  });
  screen.prepend(mosaic);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');let cursor=0,next=12,timer;
  function active(){return !document.hidden && !screen.classList.contains('hidden') && !reduce.matches;}
  function schedule(){clearTimeout(timer);if(active())timer=setTimeout(swap,2800);}
  function swap(){
    if(!active())return;
    const slot=tiles[cursor%tiles.length];cursor+=5;
    let index=next++%photos.length;
    for(let tries=0;tries<photos.length && tiles.some(t=>t.index===index);tries++)index=next++%photos.length;
    const image=new Image();image.alt='';image.decoding='async';image.draggable=false;image.className='ac-photo-enter';
    image.onload=()=>{if(!active()){schedule();return;}const old=slot.image;slot.tile.append(image);requestAnimationFrame(()=>requestAnimationFrame(()=>image.classList.add('is-visible')));slot.image=image;slot.index=index;setTimeout(()=>old.remove(),1500);schedule();};
    image.onerror=schedule;image.src=photos[index];
  }
  new MutationObserver(schedule).observe(screen,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',schedule);reduce.addEventListener('change',schedule);schedule();
})();
