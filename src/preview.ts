import {
  FileSystemAdapter,
  ItemView,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
} from 'obsidian';
import { convertHtml } from './convertImage';
import { exportSlide } from './export';
import { marp } from './marp';
import { MarpPluginSettings } from './settings';
import { join } from 'path';
import fs from 'fs/promises';

export const MARP_PREVIEW_VIEW_TYPE = 'marp-preview-view';

interface PreviewViewState {
  file: TFile | null;
}
type AsyncFunc<T, R> = (arg: T) => Promise<R>;

function pipeAsync<T>(...fns: AsyncFunc<T, T>[]): AsyncFunc<T, T> {
  return (x: T) => fns.reduce(async (v, f) => f(await v), Promise.resolve(x));
}


export class PreviewView extends ItemView implements PreviewViewState {
  file: TFile | null;
  settings: MarpPluginSettings;
  constructor(leaf: WorkspaceLeaf, settings: MarpPluginSettings) {
    super(leaf);
    this.file = null;
    this.settings = settings;
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
      if(name.match(/\|/)){
        const [name2, size] = name.split('|');
        const url = this.app.vault.adapter.getResourcePath(name2);
        return `![${size}](${url}|${size})`;
      }else{
        const url = this.app.vault.adapter.getResourcePath(name);
        return `![${name}](${url})`;
      }
    });
    return replacedMarkdown;
  }

  async replaceCssWikiLinks(markdown: string): Promise<string> {
    const wikilinkRegex = /\[\[(.+?\.css)\]\]/g;
    const css : [string,string][] = []
    for(let m of markdown.matchAll(wikilinkRegex)){
      const name = m[1];
      //nameはmarkdownなので、cssコードブロックを抽出する
      const basePath = (
        this.app.vault.adapter as FileSystemAdapter
      ).getBasePath();
      const cssMdPath = join(basePath, name);
      const cssMdContent = await fs.readFile(cssMdPath+'.md', 'utf-8');
      //cssコードブロックを抽出（すべてのCSSコードブロックを連結する）
      const cssCode = Array.from(cssMdContent.matchAll(/```css\n(.+?)\n```/gsm)).reduce<string[]>((acc,v)=>[...acc,v[1]],[]);
      if(cssCode && cssCode.length>0){
        css.push([name,cssCode.join('\n')]);
      }
    };
    for(const [name,code] of css){
      markdown = markdown.replace(`[[${name}]]`,`<style>${code}</style>`);
    }
    return markdown;
  }

  async renderPreview() {
    if (!this.file) return;

    const originContent = await this.app.vault.cachedRead(this.file);
    const content = await pipeAsync<string>(
      this.replaceImageWikilinks.bind(this),
      this.replaceCssWikiLinks.bind(this),
    )(originContent);
    const { html, css } = marp.render(content);
    const doc = await convertHtml(html);
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(doc.body.children[0]);
    container.createEl('style', { text: css });
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
    this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
    this.registerEvent(this.app.workspace.on('editor-change', this.onEditorChange.bind(this)));
    this.addActions();
  }
  onFileOpen(file: TFile){
    this.file = file;
    this.renderPreview();
  }
  onEditorChange(editor: any,{ file } : { file: TFile }){
    if(this.file === file){
      this.renderPreview();
    }
  }

  async onClose() {
    // Nothing to clean up.
  }

  onChange() {
    if (!this.settings.autoReload) return;
    this.renderPreview();
  }

  async setState(state: PreviewViewState, result: ViewStateResult) {
    if (state.file) {
      this.file = state.file;
    }
    await this.renderPreview();
    return super.setState(state, result);
  }

  getState(): PreviewViewState {
    return {
      file: this.file,
    };
  }
}
