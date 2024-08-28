import { exec } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { Notice, TFile } from 'obsidian';
import { convertToBase64 } from './convertImage';
import { join, normalize } from 'path';
import fixPath from 'fix-path';
import { getEngine } from './engine';
import mermaid from 'mermaid';

const imgPathReg =  /!\[\[(.+?)\]\]/g;

function matchAllJoin(regex: RegExp, text: string): string {
  return Array.from(text.matchAll(regex)).reduce((acc, v) => [...acc,v[1]], []).join('\n').trim();
}

const replaceCssWikiLinks = async (basePath: string,markdown: string) : Promise<string> =>{
  const wikilinkRegex = /\[\[(.+?\.css)\]\]/g;
  const css : [string,string][] = []
  const mermaid : string[] = []
  for(let m of markdown.matchAll(wikilinkRegex)){
    const name = m[1];
    //nameはmarkdownなので、cssコードブロックを抽出する
    const cssMdPath = join(basePath, name);
    const cssMdContent = await readFile(cssMdPath+'.md', 'utf-8');
    //cssコードブロックを抽出（すべてのCSSコードブロックを連結する）
    // Array.from(cssMdContent.matchAll(/```css\n(.+?)\n```/gsm)).reduce<string[]>((acc,v)=>[...acc,v[1]],[]);
    const cssCode = matchAllJoin(/```css\n(.+?)\n```/gsm,cssMdContent);
    // Array.from(cssMdContent.matchAll(/```mermaid\n(.+?)\n```/gsm)).reduce<string[]>((acc,v)=>[...acc,v[1]],[]);
    const mermaidCode = matchAllJoin(/```mermaid\n(.+?)\n```/gsm,cssMdContent);
    if(cssCode){
      css.push([name,cssCode]);
    }
    //%%{ }%%で囲まれたmermaidコードを抽出
    if(mermaidCode){
      mermaid.push(matchAllJoin(/(%%{.+?}%%)/gsm,mermaidCode));
    }
  };
  for(const [name,code] of css){
    markdown = markdown.replace(`[[${name}]]`,`<style>${code}</style>`);
  }
  if(mermaid.length > 0){
    const globalMermaid = mermaid.join('\n');
    markdown = markdown.replace(/```mermaid/g,"```mermaid\n"+globalMermaid);
  }
  return markdown;
}

export async function exportSlide(
  file: TFile,
  ext: 'html' | 'pdf' | 'pptx',
  basePath: string,
  themeDir: string,
) {
  const exportDir = join(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME']!,
    'Downloads',
  );
  if (!file) return;
  const filePath = normalize(join(basePath, file.path));
  const tmpPath = join(exportDir, `${file.basename}.tmp`);
  const tmpEnginePath = join(exportDir, 'engine.js');

  let fileContent = await readFile(filePath, 'utf-8');


  const srcBase64TupleList = await Promise.all(
    [...new Set([...fileContent.matchAll(imgPathReg)].map(v => v[1]))].map(
      async v => {
        if(v.match(/\|/)){
          const [name, size] = v.split('|');
          return [v, await convertToBase64(name), size] as const;
        }
        return [v, await convertToBase64(v),undefined] as const
      }
    ),
  );

  fileContent = await replaceCssWikiLinks(basePath,fileContent);

  let mermaidSvgId=0;
  const mermaidSvgTupleList : [string,string][] = [];
  const matches = fileContent.matchAll(/```mermaid\n(.+?)\n```/gsm);
  for (let m of matches) {
    const code = m[1];
    try {
      const result = await mermaid.mermaidAPI.render('mermaid-svg-' + (mermaidSvgId++) , code);
      mermaidSvgTupleList.push([code,result.svg]);        
    }catch(e){
      console.log(m[1]);
      new Notice(`Mermaid error: ${e.message}`, 20000);
      continue;
    }
  }

  for (const [src, base64, size] of srcBase64TupleList) {
    fileContent = fileContent.replace(
      `![[${src}]]`,
      `![${size || src}](${base64})`,
    );
  }

  for (const [code, svg] of mermaidSvgTupleList) {
    console.log({code,svg});
    fileContent = fileContent.replace(
      '```mermaid\n' + code + '\n```',
      `<div class="mermaid-svg">${svg}</div>\n`,
    );
  }

  await mkdir(exportDir, { recursive: true });
  try {
    await writeFile(tmpPath, fileContent);
    await writeFile(tmpEnginePath, getEngine());
  } catch (e) {
    console.error(e);
  }

  let cmd: string;
  try {
    await access(themeDir);
    cmd = `npx -y @marp-team/marp-cli@latest --html --bespoke.transition --stdin false --allow-local-files --theme-set "${themeDir}" -o "${join(
      exportDir,
      file.basename,
    )}.${ext}" --engine ${tmpEnginePath} -- "${tmpPath}"`;
  } catch (e) {
    cmd = `npx -y @marp-team/marp-cli@latest --html --stdin false --allow-local-files --bespoke.transition -o "${join(
      exportDir,
      file.basename,
    )}.${ext}" --engine ${tmpEnginePath} -- "${tmpPath}"`;
  }

  fixPath();
  new Notice(`Exporting "${file.basename}.${ext}" to "${exportDir}"`, 20000);
  exec(cmd, () => {
    new Notice(`Exported successfully`, 20000);
    rm(tmpPath);
    rm(tmpEnginePath);
  });
}
