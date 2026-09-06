import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('A stable three-part version is required');
const tag='v'+pkg.version,dir=resolve(process.argv[2]||pkg.build.directories.output);
if(readFileSync('downloads/versions/'+tag+'.md','utf8').includes('RELEASE_NOTES_TODO'))throw Error('Finish version notes first');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=['Portable','Setup'].map(kind=>{
const name='HashPlay-'+kind+'-'+pkg.version+'.exe',path=join(dir,name),bytes=statSync(path).size;
if(bytes<1000000)throw Error('Incomplete artifact: '+name);
return {name,bytes,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),url:'https://github.com/wp222hx-art/hxgogo/releases/download/'+tag+'/'+name};
});
const manifest={version:pkg.version,tag,platform:'windows',architecture:'x64',sourceCommit,generatedAt:new Date().toISOString(),files};
writeFileSync(join(dir,'SHA256SUMS.txt'),files.map(f=>f.sha256+'  '+f.name).join('\n')+'\n');
writeFileSync(join(dir,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
