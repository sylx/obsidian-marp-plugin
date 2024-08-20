import { exec } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { Notice, TFile } from 'obsidian';
import { convertToBase64 } from './convertImage';
import { join, normalize } from 'path';
import fixPath from 'fix-path';
import { getEngine } from './engine';
import mermaid from 'mermaid';

const imgPathReg =  /!\[\[(.+?)\]\]/g;


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

  let mermaidSvgId=0;
  const mermaidSvgTupleList : [string,string][] = [];
  for(let m of fileContent.matchAll(/```mermaid\n(.+?)\n```/gs)){
    const code = m[1];
    const result = await mermaid.mermaidAPI.render('mermaid-svg-' + (mermaidSvgId++) , code);
    mermaidSvgTupleList.push([code,result.svg]);
  }

  for (const [src, base64, size] of srcBase64TupleList) {
    fileContent = fileContent.replace(
      `![[${src}]]`,
      `![${size || src}](${base64})`,
    );
  }

  for (const [code, svg] of mermaidSvgTupleList) {
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
