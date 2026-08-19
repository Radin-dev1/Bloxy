import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';

const mount=document.querySelector('#scene'),statusEl=document.querySelector('#status'),scene=new THREE.Scene();
const studioSky=new THREE.Color(0x92c9ef);scene.background=studioSky;scene.fog=new THREE.Fog(studioSky,2400,7600);
const camera=new THREE.PerspectiveCamera(50,1,.5,12000);camera.position.set(1450,1050,1450);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;mount.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.target.set(0,18,0);controls.maxPolarAngle=Math.PI/2-.015;controls.minDistance=180;controls.maxDistance=4600;

// Roblox Studio-style daylight: cool sky ambience with a warm directional sun.
scene.add(new THREE.HemisphereLight(0xcfeaff,0x52623a,1.45));scene.add(new THREE.AmbientLight(0xb9d7ef,.42));
const sun=new THREE.DirectionalLight(0xfff0cf,3.35);sun.position.set(-1300,2200,950);sun.target.position.set(0,0,0);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-2300;sun.shadow.camera.right=2300;sun.shadow.camera.top=2300;sun.shadow.camera.bottom=-2300;sun.shadow.camera.near=10;sun.shadow.camera.far=6000;sun.shadow.bias=-.00035;sun.shadow.normalBias=.035;scene.add(sun,sun.target);
const grid=new THREE.GridHelper(4096,128,0x5d6265,0x74797b);grid.position.y=16.35;grid.material.transparent=true;grid.material.opacity=.34;scene.add(grid);

let plate;const diffuse=new THREE.TextureLoader().load('assets/baseplate-diffuse.png');diffuse.wrapS=diffuse.wrapT=THREE.RepeatWrapping;diffuse.colorSpace=THREE.SRGBColorSpace;diffuse.anisotropy=renderer.capabilities.getMaxAnisotropy();
new OBJLoader().load('assets/baseplate.obj',object=>{plate=object;object.traverse(child=>{if(!child.isMesh)return;const isTop=child.name==='Baseplate2';child.material=new THREE.MeshStandardMaterial({color:isTop?0xffffff:0x333638,map:isTop?diffuse:null,roughness:isTop?.86:.94,metalness:0});child.receiveShadow=true;child.castShadow=!isTop});scene.add(object);statusEl.textContent='Roblox baseplate · Future lighting'},undefined,()=>statusEl.textContent='Baseplate failed to load · refresh to retry');
new ResizeObserver(()=>{const w=mount.clientWidth,h=mount.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}).observe(mount);renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});

const $=selector=>document.querySelector(selector),toast=message=>{const t=$('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1700)};
$('#home').onclick=()=>{camera.position.set(1450,1050,1450);controls.target.set(0,18,0)};$('#grid').onclick=()=>grid.visible=!grid.visible;

const classPicker=$('#classPicker'),classList=$('#classList'),classSearch=$('#classSearch');
let studioClasses=[];
const iconMarkup=className=>`<i class="class-icon" data-class="${className}"></i>`;
const applyClassIcons=root=>root.querySelectorAll('.class-icon').forEach(icon=>{const item=studioClasses.find(entry=>entry.name===icon.dataset.class);if(item)icon.style.backgroundPosition=`-${item.icon*16}px 0`});
function renderClasses(query=''){
  const search=query.trim().toLowerCase();
  const matches=studioClasses.filter(item=>!search||item.name.toLowerCase().includes(search)).slice(0,300);
  classList.innerHTML=matches.length?matches.map(item=>`<button data-name="${item.name}">${iconMarkup(item.name)}<span>${item.name}</span><em>${item.category}</em></button>`).join(''):'<p>No matching Roblox classes.</p>';
  applyClassIcons(classList);
}
fetch('assets/ReflectionMetadata.xml').then(response=>response.text()).then(source=>{
  const xml=new DOMParser().parseFromString(source,'application/xml');
  studioClasses=[...xml.querySelectorAll('Item[class="ReflectionMetadataClasses"] > Item[class="ReflectionMetadataClass"] > Properties')].map(properties=>{
    const read=name=>properties.querySelector(`[name="${name}"]`)?.textContent?.trim()||'';
    return {name:read('Name'),category:read('ClassCategory')||'Engine',icon:Number(read('ExplorerImageIndex')||0),browsable:read('Browsable')!=='false'};
  }).filter(item=>item.name&&item.browsable).sort((a,b)=>a.name.localeCompare(b.name));
  applyClassIcons(document);
  renderClasses();
}).catch(()=>classList.innerHTML='<p>Could not load the Studio class catalog.</p>');
$('#add').onclick=()=>{classPicker.showModal();classSearch.value='';renderClasses();setTimeout(()=>classSearch.focus(),50)};
$('#closeClasses').onclick=()=>classPicker.close();
classSearch.oninput=event=>renderClasses(event.target.value);
classList.onclick=event=>{
  const button=event.target.closest('button[data-name]');if(!button)return;
  const className=button.dataset.name;
  if(['Part','MeshPart','SpawnLocation','TrussPart','WedgePart','CornerWedgePart'].includes(className)){
    const part=new THREE.Mesh(new THREE.BoxGeometry(160,160,160),new THREE.MeshStandardMaterial({color:0xa3c76d,roughness:.72}));part.position.set((Math.random()-.5)*700,96,(Math.random()-.5)*700);part.castShadow=true;part.receiveShadow=true;scene.add(part);
  }
  classPicker.close();toast(`${className} selected`);
};
$('#color').oninput=event=>plate?.traverse(child=>{if(child.isMesh&&child.name==='Baseplate2')child.material.color.set(event.target.value)});document.querySelectorAll('.toggle').forEach(button=>button.onclick=()=>button.classList.toggle('on'));
const pair=$('#pair');$('#pairBtn').onclick=()=>pair.showModal();$('#close').onclick=()=>pair.close();$('#code').onclick=()=>{navigator.clipboard?.writeText('BX7K-R4M2');toast('Pair code copied')};
const prompt=$('#prompt'),messages=$('#messages');function send(){const value=prompt.value.trim();if(!value)return;const safe=value.replace(/[<>&]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[char]));messages.insertAdjacentHTML('beforeend',`<article><b>Y</b><p><small>YOU</small>${safe}</p></article><article><b>B</b><p><small>BLOXY</small>Blueprint ready for backend generation. Pair Studio when the secure API is connected.</p></article>`);prompt.value='';messages.scrollTop=messages.scrollHeight}$('#send').onclick=send;prompt.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}};document.querySelectorAll('.ideas button').forEach(button=>button.onclick=()=>{prompt.value=button.textContent;prompt.focus()});

const viewport=$('.viewport'),radial=$('#radial');
function chooseTool(name){document.querySelectorAll('.tool').forEach(button=>button.classList.toggle('active',button.dataset.tool===name));toast(`${name} tool`)}
document.querySelectorAll('.tool').forEach(button=>button.onclick=()=>chooseTool(button.dataset.tool));
document.addEventListener('keydown',event=>{if(event.target.matches('input,textarea'))return;const tools={q:'Select',w:'Move',e:'Scale',r:'Rotate'};if(tools[event.key.toLowerCase()])chooseTool(tools[event.key.toLowerCase()])});
$('#play').onclick=event=>{event.currentTarget.classList.toggle('running');const running=event.currentTarget.classList.contains('running');event.currentTarget.firstChild.textContent=running?'■':'▶';statusEl.textContent=running?'Play test running':'Roblox baseplate · Future lighting';toast(running?'Play test started':'Play test stopped')};
viewport.addEventListener('contextmenu',event=>{event.preventDefault();const bounds=viewport.getBoundingClientRect();radial.style.setProperty('--rx',`${event.clientX-bounds.left}px`);radial.style.setProperty('--ry',`${event.clientY-bounds.top}px`);radial.classList.add('open');radial.setAttribute('aria-hidden','false')});
viewport.addEventListener('pointerdown',event=>{if(!event.target.closest('#radial')&&event.button!==2){radial.classList.remove('open');radial.setAttribute('aria-hidden','true')}});
radial.onclick=event=>{const action=event.target.closest('button')?.dataset.action;if(!action)return;radial.classList.remove('open');if(action==='AI'){prompt.focus();toast('Describe what to build')}else{$('#add').click();classSearch.value=action==='UI'?'Gui':action;renderClasses(classSearch.value)}};
