'use strict';
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../src/assets');
app.disableHardwareAcceleration();
function load(name){const image=nativeImage.createFromPath(path.join(root,name));if(image.isEmpty())throw new Error('Bild konnte nicht dekodiert werden: '+name);return image;}
function contain(image,width,height){const size=image.getSize(),scale=Math.min(width/size.width,height/size.height);const w=Math.max(1,Math.round(size.width*scale)),h=Math.max(1,Math.round(size.height*scale));const resized=image.resize({width:w,height:h,quality:'best'}),src=resized.toBitmap(),data=Buffer.alloc(width*height*4);for(let i=0;i<width*height;i++){data[i*4]=9;data[i*4+1]=9;data[i*4+2]=9;data[i*4+3]=255;}const x=Math.floor((width-w)/2),y=Math.floor((height-h)/2);for(let row=0;row<h;row++)src.copy(data,((y+row)*width+x)*4,row*w*4,(row+1)*w*4);return nativeImage.createFromBitmap(data,{width,height});}
function bmp(image){const {width:w,height:h}=image.getSize(),src=image.toBitmap(),stride=(w*3+3)&~3,b=Buffer.alloc(54+stride*h);b.write('BM');b.writeUInt32LE(b.length,2);b.writeUInt32LE(54,10);b.writeUInt32LE(40,14);b.writeInt32LE(w,18);b.writeInt32LE(h,22);b.writeUInt16LE(1,26);b.writeUInt16LE(24,28);b.writeUInt32LE(stride*h,34);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const source=(y*w+x)*4,target=54+(h-y-1)*stride+x*3;src.copy(b,target,source,source+3);}return b;}
function ico(image){const images=[16,24,32,48,64,128,256].map(n=>({n,png:contain(image,n,n).toPNG()}));let offset=6+16*images.length;const head=Buffer.alloc(offset);head.writeUInt16LE(1,2);head.writeUInt16LE(images.length,4);images.forEach(({n,png},i)=>{const at=6+i*16;head[at]=n===256?0:n;head[at+1]=head[at];head.writeUInt16LE(1,at+4);head.writeUInt16LE(32,at+6);head.writeUInt32LE(png.length,at+8);head.writeUInt32LE(offset,at+12);offset+=png.length;});return Buffer.concat([head,...images.map(x=>x.png)]);}
app.whenReady().then(()=>{
  for(const item of require('../src/assets/artwork-manifest.json')){const bytes=fs.readFileSync(path.join(root,'source',item.file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Originalbild verändert: '+item.file);load('source/'+item.file);}
  const logo=load('brand-logo.jpg'),rose=load('source/rose-original.jpeg'),installerArt=load('source/michelle-sarah-installer.jpg');
  fs.writeFileSync(path.join(root,'icon.png'),contain(logo,256,256).toPNG());
  fs.writeFileSync(path.join(root,'installer.ico'),ico(rose));
  const sidebar=installerArt.crop({x:258,y:0,width:564,height:1080}).resize({width:164,height:314,quality:'best'});
  const header=installerArt.crop({x:190,y:200,width:700,height:266}).resize({width:150,height:57,quality:'best'});
  fs.writeFileSync(path.join(root,'installer-sidebar.bmp'),bmp(sidebar));
  fs.writeFileSync(path.join(root,'installer-header.bmp'),bmp(header));
  // Only the marble texture is cropped; all four supplied artworks remain byte-identical.
  const size=rose.getSize();const marble=rose.crop({x:0,y:Math.round(size.height*.44),width:Math.round(size.width*.14),height:Math.round(size.height*.24)});
  fs.writeFileSync(path.join(root,'marble.jpg'),marble.resize({width:630,height:600,quality:'best'}).toJPEG(92));
  for(const file of ['icon.png','marble.jpg'])load(file);
  console.log('Sechs Originalbilder, proportionale Logos sowie Michelle/Sarah-Installer-Grafiken geprüft.');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
