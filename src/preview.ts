import {
	FileSystemAdapter,
	ItemView,
	TFile,
	ViewStateResult,
	Workspace,
	WorkspaceLeaf
} from 'obsidian';
import { exportSlide } from './export';
import { marp } from './marp';
import { MarpPluginSettings } from './settings';
import { join } from 'path';

import morphdom from 'morphdom';
import { createOrGetCurrentPageStore, createOrGetMarpSlideInfoStore, getMarpPageInfo, MarpSlidePageInfo, setCurrentPage } from './store';
import { MarpMarkdownProcessor } from './MarpMarkdownProcessor';
import { MarpExporter } from './MarpExporter';


export const MARP_PREVIEW_VIEW_TYPE = 'marp-preview-view';

interface PreviewViewState {
  file: TFile | null;
}

export function getPreviewView(workspace: Workspace): PreviewView | undefined {
  return workspace.getLeavesOfType(MARP_PREVIEW_VIEW_TYPE)[0]?.view as PreviewView;
}

export function getPreviewViewByFile(workspace: Workspace, file: TFile): PreviewView[]{
  return workspace.getLeavesOfType(MARP_PREVIEW_VIEW_TYPE).filter(leaf => leaf.view instanceof PreviewView && leaf.view.file === file)?.map(leaf => leaf.view as PreviewView) ?? [];
}

export class PreviewView extends ItemView implements PreviewViewState {
  file: TFile | null;
  settings: MarpPluginSettings;

  protected bodyEl: HTMLElement;
  protected styleEl: HTMLStyleElement;
  protected markdownCache: string[] = [];
  protected unsubscribe: any[] = [];
  protected processor: MarpMarkdownProcessor;
  protected exporter: MarpExporter;

  constructor(leaf: WorkspaceLeaf, settings: MarpPluginSettings) {
    super(leaf);
    this.file = null;
    this.settings = settings;
    this.bodyEl = this.contentEl.createDiv();
    this.styleEl = this.contentEl.createEl('style');
	this.processor = new MarpMarkdownProcessor(this.app);
	this.exporter = new MarpExporter(this.app);
  }

  getViewType(): string {
    return MARP_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `Marp Preview ${this.file?.path ?? ''}`;
  }


  async renderPreview(pageInfo: readonly MarpSlidePageInfo[]) {
    if(this.markdownCache.length !== pageInfo.length){
      this.markdownCache = new Array(pageInfo.length);
    }
	console.log("renderPreview",pageInfo);
    for(const info of pageInfo){
      if(info.isUpdate || this.markdownCache[info.page] === undefined){
        //様々な変換を行う
		const markdown = await this.processor.process(info,true);
        this.markdownCache[info.page] = markdown;
      }
    }
    const { html, css } = marp.render(this.markdownCache.join('\n---\n'));
    morphdom(this.bodyEl, html);
    if (this.styleEl.innerHTML !== css) {
      this.styleEl.innerHTML = css;
    }
  }

  async prepareExport(pageInfo: readonly MarpSlidePageInfo[]) {
	const pages = await Promise.all(pageInfo.map(info =>this.processor.process(info,false)))
	return pages.join('\n---\n');
  }

  protected downloadFile(buffer: Buffer, filename: string, type: string) {
	const blob = new Blob([buffer], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url
	a.download = filename;
	a.click();
  }
	

  addActions() {
    const basePath = (
      this.app.vault.adapter as FileSystemAdapter
    ).getBasePath();
    const themeDir = join(basePath, this.settings.themeDir);
    this.addAction('download', 'Export as PDF', async () => {
		if(!this.file) return
		const pageInfo = getMarpPageInfo(this.file);
		const markdown = await this.prepareExport(pageInfo);
		const buffer = await this.exporter.exportPdf(markdown);
		this.downloadFile(buffer, this.file.basename + '.pdf', 'application/pdf');
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
    this.registerDomEvent(this.containerEl,'click',(e)=>{
      const clicked = e.target as HTMLElement;
      //svgまで遡る
      const svg = clicked.closest('svg');
      if(svg){
        const allSlides = this.bodyEl.querySelectorAll('.marpit > svg');
        const page = Array.from(allSlides).indexOf(svg);
		setCurrentPage(this.file!, page,"preview");
		//this.moveCursorToPage(page);
      }
    })
    //this.registerEvent(this.app.workspace.on('editor-change', this.onEditorChange.bind(this)));
    this.addActions();

  }
  async onClose() {
    this.unsubscribe.forEach((unsub: any) => unsub());
    this.unsubscribe = [];
    this.markdownCache = [];    
  }
  onFileOpen(file: TFile) {
    if (file.extension === 'md') {
      this.setState({ file }, { history: true });
    }
  }

  moveCursorToPage(page: number) {
    //scroll to the cursor position
    if (page > -1) {
      const allSlides = this.bodyEl.querySelectorAll('.marpit > svg');
      allSlides.forEach((slide, index) => {
        if (index === page) {
          slide.classList.add('cursor');
          setTimeout(() => {
            slide.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        } else {
          slide.classList.remove('cursor');
        }
      });
    }
  }

  async setState(state: PreviewViewState, result: ViewStateResult) {

    this.unsubscribe.forEach((unsub: any) => unsub());
    this.unsubscribe = [];
    this.markdownCache = [];    
    if (state.file) {
      // subscribe
      const $content = createOrGetMarpSlideInfoStore(state.file);
      this.register($content.subscribe((info) => {
        this.renderPreview(info);
      }))
      const $page = createOrGetCurrentPageStore(state.file);
      this.register($page.subscribe(({page,setBy}) => {
		if(setBy === "preview") return;
        this.moveCursorToPage(page);
      }));
      
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
