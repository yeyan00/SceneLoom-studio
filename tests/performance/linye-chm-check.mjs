import { open, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createAccumulator, finishChm } from '../../server/chm/algorithm.mjs';

// Read uncompressed LAS point formats 6–10 for a reproducible algorithm check.
// No input files or project history are modified.
const source = path.resolve(process.argv[2] || 'data/linye');
const output = path.resolve('test-results/linye-chm');
await mkdir(output, {recursive:true});
const reports=[];
for (const name of (await readdir(source)).filter(n=>n.toLowerCase().endsWith('.las'))) {
  const file=await open(path.join(source,name));
  try {
    const header=Buffer.alloc(393); await file.read(header,0,header.length,0);
    const format=header[104];
    if(header.toString('ascii',0,4)!=='LASF'||format<6||format>10) throw Error('Unsupported LAS format');
    const count=Number(header.readBigUInt64LE(247)), size=header.readUInt16LE(105), offset=header.readUInt32LE(96);
    const scale=[0,1,2].map(i=>header.readDoubleLE(131+i*8));
    const bounds={min:[187,203,219].map(i=>header.readDoubleLE(i)),max:[179,195,211].map(i=>header.readDoubleLE(i))};
    const origin=[0,1,2].map(i=>header.readDoubleLE(155+i*8));
    const local={min:bounds.min.map((v,i)=>v-origin[i]),max:bounds.max.map((v,i)=>v-origin[i])};
    const variants=[{seedDistance:3,groundMode:'auto'},{seedDistance:2,groundMode:'auto'},{seedDistance:4,groundMode:'auto'},{seedDistance:3,groundMode:'estimate'}];
    const accumulators=variants.map(p=>createAccumulator(local,p));
    const classes={}, start=performance.now();
    const chunkPoints=100000, buffer=Buffer.alloc(chunkPoints*size);
    for(let first=0;first<count;first+=chunkPoints){
      const n=Math.min(chunkPoints,count-first), bytes=n*size;
      let read=0;while(read<bytes){const r=await file.read(buffer,read,bytes-read,offset+first*size+read);if(!r.bytesRead)throw Error('Truncated LAS');read+=r.bytesRead;}
      for(let i=0;i<n;i++){
        const b=i*size, x=buffer.readInt32LE(b)*scale[0], y=buffer.readInt32LE(b+4)*scale[1], z=buffer.readInt32LE(b+8)*scale[2], category=buffer[b+16];
        classes[category]=(classes[category]||0)+1;
        for(const acc of accumulators)acc.add(x,y,z,category);
      }
    }
    const scanMs=performance.now()-start, results=[];
    for(let k=0;k<variants.length;k++){
      const at=performance.now(), result=finishChm(accumulators[k]), computeMs=performance.now()-at;
      const {grid,preview}=result, areas=new Map();
      for(const id of grid.labels)if(id)areas.set(id,(areas.get(id)||0)+grid.resolution**2);
      const sorted=[...areas.values()].sort((a,b)=>a-b), heights=preview.heights.filter(v=>v!==null).sort((a,b)=>a-b);
      const stem=path.basename(name,'.las')+'-'+k;
      for(const mode of ['height','instances']){
        const png=new PNG({width:grid.width,height:grid.height});
        for(let i=0;i<grid.labels.length;i++){
          const id=grid.labels[i], h=preview.heights[i], p=((grid.height-1-Math.floor(i/grid.width))*grid.width+i%grid.width)*4;
          let rgb=[25,29,35];
          if(mode==='instances'&&id)rgb=[(id*71)%200+55,(id*131)%200+55,(id*193)%200+55];
          if(mode==='height'&&h!==null){const t=Math.max(0,Math.min(1,h/25));rgb=[Math.round(255*t),Math.round(200*Math.sin(t*Math.PI)),Math.round(220*(1-t))];}
          png.data.set([...rgb,255],p);
        }
        await writeFile(path.join(output,stem+'-'+mode+'.png'),PNG.sync.write(png));
      }
      await writeFile(path.join(output,stem+'.json'),JSON.stringify(result));
      results.push({parameters:variants[k],treeCount:result.treeCount,stats:result.stats,warnings:result.warnings,computeMs,areaM2:{min:sorted[0],median:sorted[Math.floor(sorted.length/2)],max:sorted.at(-1)},heightM:{min:heights[0],p50:heights[Math.floor(heights.length*.5)],p95:heights[Math.floor(heights.length*.95)],max:heights.at(-1)},stem});
    }
    const report={name,version:`${header[24]}.${header[25]}`,format,count,bounds,classes,scanMs,results};
    reports.push(report);console.log(JSON.stringify(report,null,2));
  }finally{await file.close();}
}
await writeFile(path.join(output,'report.json'),JSON.stringify(reports,null,2));
