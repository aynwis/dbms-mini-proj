/* Client-side data layer. Tables/columns/constraints mirror DBMS_MINI_PROJECT_VISHWASRAO_WARIS_VAGHASIYA.sql exactly. Stored in localStorage. */
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Date().toISOString().slice(0,10),now=()=>new Date().toISOString();
const DB={
 get(t){try{return JSON.parse(localStorage.getItem('edu_'+t))||[]}catch{return[]}},
 set(t,v){localStorage.setItem('edu_'+t,JSON.stringify(v))},
 insert(t,pk,row){const a=this.get(t),r={[pk]:a.reduce((m,x)=>Math.max(m,x[pk]),0)+1,...row,created_at:now()};a.push(r);this.set(t,a);return r},
 update(t,pk,id,p){const a=this.get(t),r=a.find(x=>x[pk]==id);Object.assign(r,p);if('updated_at'in r)r.updated_at=now();this.set(t,a);return r},
 del(t,fn){this.set(t,this.get(t).filter(x=>!fn(x)))}
};
if(!DB.get('exam_category').length)['JEE','NEET','UPSC'].forEach(n=>DB.insert('exam_category','category_id',{category_name:n})); // seed categories from the SQL file
async function hash(p){const d=new TextEncoder().encode('eduprep:'+p);try{return[...new Uint8Array(await crypto.subtle.digest('SHA-256',d))].map(b=>b.toString(16).padStart(2,'0')).join('')}catch{let h=5381;for(const b of d)h=(h*33^b)>>>0;return'x'+h}}
const Auth={
 user(){try{return JSON.parse(sessionStorage.getItem('edu_session'))}catch{return null}},
 need(role){const s=this.user();if(!s||s.role!==role){location.href='index.html';throw 0}return DB.get(role).find(r=>r[role+'_id']==s.id)||(this.out(),0)},
 out(){sessionStorage.removeItem('edu_session');location.href='index.html'},
 async login(role,email,pw){const u=DB.get(role).find(r=>r.email===email.trim().toLowerCase());if(!u||u.password_hash!==await hash(pw))throw'Incorrect email or password.';sessionStorage.setItem('edu_session',JSON.stringify({role,id:u[role+'_id']}))},
 async register(role,d){const e=d.email.trim().toLowerCase();if(DB.get(role).some(r=>r.email===e))throw'This email is already registered.';
  if(d.password.length<6)throw'Password must be at least 6 characters.';const ph=await hash(d.password),base={name:d.name.trim(),email:e,password_hash:ph};let r;
  if(role==='student')r=DB.insert('student','student_id',{...base,phone:d.phone||null,city:d.city||null,registered_exam_id:+d.exam||null,registration_date:today(),updated_at:now()});
  else{const x=+d.exp||0;if(x<0)throw'Experience cannot be negative.';r=DB.insert('instructor','instructor_id',{...base,qualification:d.qual||null,experience_years:x,updated_at:now()})}
  sessionStorage.setItem('edu_session',JSON.stringify({role,id:r[role+'_id']}))}
};
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',2600)}
/* test_paper_link: either an http(s) link or idb://<key>/<filename> for files uploaded in the browser */
const IDB={open(){return new Promise((ok,no)=>{const r=indexedDB.open('eduprep',1);r.onupgradeneeded=()=>r.result.createObjectStore('f');r.onsuccess=()=>ok(r.result);r.onerror=no})},
 async put(k,b){const d=await this.open();return new Promise((ok,no)=>{const t=d.transaction('f','readwrite');t.objectStore('f').put(b,k);t.oncomplete=ok;t.onerror=no})},
 async get(k){const d=await this.open();return new Promise((ok,no)=>{const q=d.transaction('f').objectStore('f').get(k);q.onsuccess=()=>ok(q.result);q.onerror=no})},
 async del(k){const d=await this.open();return new Promise(ok=>{const t=d.transaction('f','readwrite');t.objectStore('f').delete(k);t.oncomplete=ok})}};
async function download(link){if(!link.startsWith('idb://'))return window.open(link,'_blank','noopener');const [k,...n]=link.slice(6).split('/'),b=await IDB.get(k);if(!b)return toast('File not found on this device.');const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=decodeURIComponent(n.join('/'))||'paper';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4e3)}