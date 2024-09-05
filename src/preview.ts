import {
  FileSystemAdapter,
  ItemView,
  TFile,
  ViewStateResult,
  Workspace,
  WorkspaceLeaf
} from 'obsidian';
import { convertMermaidToDataUrl } from './convertImage';
import { exportSlide } from './export';
import { marp } from './marp';
import { MarpPluginSettings } from './settings';
import { join } from 'path';
import fs from 'fs/promises';

import morphdom from 'morphdom';
import { PageInfo } from './EditorExtension';

export const MARP_PREVIEW_VIEW_TYPE = 'marp-preview-view';

interface PreviewViewState {
  file: TFile | null;
}
type AsyncFunc<T, R> = (arg: T) => Promise<R>;

function pipeAsync<T>(...fns: AsyncFunc<T, T>[]): AsyncFunc<T, T> {
  return (x: T) => fns.reduce(async (v, f) => f(await v), Promise.resolve(x));
}

function matchAllJoin(regex: RegExp, text: string): string {
  return Array.from(text.matchAll(regex)).reduce((acc, v) => [...acc, v[1]], []).join('\n').trim();
}

export function getPreviewView(workspace: Workspace): PreviewView | undefined {
  return workspace.getLeavesOfType(MARP_PREVIEW_VIEW_TYPE)[0]?.view as PreviewView;
}

export class PreviewView extends ItemView implements PreviewViewState {
  file: TFile | null;
  settings: MarpPluginSettings;

  protected bodyEl: HTMLElement;
  protected styleEl: HTMLStyleElement;
  protected markdownCache: string[] = [];

  constructor(leaf: WorkspaceLeaf, settings: MarpPluginSettings) {
    super(leaf);
    this.file = null;
    this.settings = settings;
    this.bodyEl = this.contentEl.createDiv();
    this.styleEl = this.contentEl.createEl('style');
    console.log("PreviewView instantiated");
  }

  getViewType(): string {
    return MARP_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Marp Preview';
  }


  // Function to replace Wikilinks with the desired format
  replaceImageWikilinks(markdown: string): string {
    // [[file.png|100x100]]とあった場合は![100x100](url)の形式にする
    const wikilinkRegex = /!\[\[(.+?)\]\]/g;
    const replacedMarkdown = markdown.replace(wikilinkRegex, (_, name) => {
      // Get url for image
      if (name.match(/\|/)) {
        const [name2, size] = name.split('|');
        const url = this.app.vault.adapter.getResourcePath(name2);
        return `![${size}](${url}|${size})`;
      } else {
        const url = this.app.vault.adapter.getResourcePath(name);
        return `![${name}](${url})`;
      }
    });
    return replacedMarkdown;
  }

  async replaceCssWikiLinks(markdown: string): Promise<string> {
    const wikilinkRegex = /\[\[(.+?\.css)\]\]/g;
    const css: [string, string][] = []
    const mermaid: string[] = []
    for (let m of markdown.matchAll(wikilinkRegex)) {
      const name = m[1];
      //nameはmarkdownなので、cssコードブロックを抽出する
      const basePath = (
        this.app.vault.adapter as FileSystemAdapter
      ).getBasePath();
      const cssMdPath = join(basePath, name);
      const cssMdContent = await fs.readFile(cssMdPath + '.md', 'utf-8');
      //cssコードブロックを抽出（すべてのCSSコードブロックを連結する）
      // Array.from(cssMdContent.matchAll(/```css\n(.+?)\n```/gsm)).reduce<string[]>((acc,v)=>[...acc,v[1]],[]);
      const cssCode = matchAllJoin(/```css\n(.+?)\n```/gsm, cssMdContent);
      // Array.from(cssMdContent.matchAll(/```mermaid\n(.+?)\n```/gsm)).reduce<string[]>((acc,v)=>[...acc,v[1]],[]);
      const mermaidCode = matchAllJoin(/```mermaid\n(.+?)\n```/gsm, cssMdContent);
      if (cssCode) {
        css.push([name, cssCode]);
      }
      //%%{ }%%で囲まれたmermaidコードを抽出
      if (mermaidCode) {
        mermaid.push(matchAllJoin(/(%%{.+?}%%)/gsm, mermaidCode));
      }
    };
    for (const [name, code] of css) {
      markdown = markdown.replace(`[[${name}]]`, `<style>${code}</style>`);
    }
    if (mermaid.length > 0) {
      const globalMermaid = mermaid.join('\n');
      markdown = markdown.replace(/```mermaid/g, "```mermaid\n" + globalMermaid);
    }
    return markdown;
  }

  async replaceMermaidCodeBlock(markdown: string): Promise<string> {
    const mermaidRegex = /```mermaid\n(.+?)\n```/gsm;
    const mermaid: [string, string][] = []
    for (let m of markdown.matchAll(mermaidRegex)) {
      const code = m[1];
      const dataurl = await convertMermaidToDataUrl(code);
      mermaid.push([code, dataurl]);
    }
    if (mermaid.length > 0) {
      for (const [code, dataurl] of mermaid) {
        markdown = markdown.replace(`\`\`\`mermaid\n${code}\n\`\`\``,
          `<img src="${dataurl}" alt="mermaid">`
        );
      }
    }
    return markdown;
  }

  async renderPreview(pageInfo: PageInfo[],notPartial: boolean = false) {
    if(notPartial){
      this.markdownCache = [];
    }
    for(const info of pageInfo){
      //様々な変換を行う
      this.markdownCache[info.page] = await pipeAsync<string>(
        this.replaceImageWikilinks.bind(this), // imageをwikilinkに変換
        this.replaceCssWikiLinks.bind(this), // styleへのリンクを処理
        this.replaceMermaidCodeBlock.bind(this), // mermaidコードを画像に変換
      )(info.content);
    }
    const { html, css } = marp.render(this.markdownCache.join('\n---\n'));
    morphdom(this.bodyEl, html);
    if (this.styleEl.innerHTML !== css) {
      this.styleEl.innerHTML = css;
    }
  }

  addActions() {
    const basePath = (
      this.app.vault.adapter as FileSystemAdapter
    ).getBasePath();
    const themeDir = join(basePath, this.settings.themeDir);
    this.addAction('download', 'Export as PDF', () => {
      if (this.file) {
        exportSlide(this.file, 'pdf', basePath, themeDir);
      }
    });
    this.addAction('image', 'Export as PPTX', () => {
      if (this.file) {
        exportSlide(this.file, 'pptx', basePath, themeDir);
      }
    });
    this.addAction('code-glyph', 'Export as HTML', () => {
      if (this.file) {
        exportSlide(this.file, 'html', basePath, themeDir);
      }
    });
  }

  async onOpen() {
    //this.registerEvent(this.app.vault.on('modify', this.onChange.bind(this)));
    //this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
    //this.registerEvent(this.app.workspace.on('editor-change', this.onEditorChange.bind(this)));
    console.log("onOpen");
    this.addActions();
  }
  async onClose() {
  }
  moveCursorToPage(page: number) {
    //scroll to the cursor position
    if (page > -1) {
      const allSlides = this.bodyEl.querySelectorAll('.marpit > svg');
      allSlides.forEach((slide, index) => {
        if (index === page) {
          slide.classList.add('cursor');
          slide.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          slide.classList.remove('cursor');
        }
      });
    }
  }

  async setState(state: PreviewViewState, result: ViewStateResult) {
    if (state.file) {
      this.file = state.file;
    }
    return super.setState(state, result);
  }

  getState(): PreviewViewState {
    return {
      file: this.file,
    };
  }
}
