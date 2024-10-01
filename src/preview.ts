import {
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  Notice,
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
import { emitMarpSlideState, getMarpPageInfo, MarpSlidePageInfo, subscribeMarpSlideContent, subscribeMarpSlideState } from './store';
import { MarpMarkdownProcessor } from './MarpMarkdownProcessor';
import { MarpExporter } from './MarpExporter';
import { ProgressBarComponent } from 'obsidian';

export const MARP_PREVIEW_VIEW_TYPE = 'marp-preview-view';

interface PreviewViewState {
	file: TFile | null;
}

export function getPreviewView(workspace: Workspace): PreviewView | undefined {
	return workspace.getLeavesOfType(MARP_PREVIEW_VIEW_TYPE)[0]?.view as PreviewView;
}

export function getPreviewViewByFile(workspace: Workspace, file: TFile): PreviewView[] {
	return workspace.getLeavesOfType(MARP_PREVIEW_VIEW_TYPE).filter(leaf => leaf.view instanceof PreviewView && leaf.view.file === file)?.map(leaf => leaf.view as PreviewView) ?? [];
}

export class PreviewView extends ItemView implements PreviewViewState {
	file: TFile | null;
	settings: MarpPluginSettings;

	protected bodyEl: HTMLElement;
	protected styleEl: HTMLStyleElement;
	protected progressBarEl: HTMLElement;
	protected markdownCache: string[] = [];
	protected unsubscribe: any[] = [];
	protected processor: MarpMarkdownProcessor;
	protected exporter: MarpExporter;
	protected progressBar: ProgressBarComponent;



	constructor(leaf: WorkspaceLeaf, settings: MarpPluginSettings) {
		super(leaf);
		this.file = null;
		this.settings = settings;
		this.progressBarEl = this.contentEl.createDiv('progress');
		this.bodyEl = this.contentEl.createDiv('preview-body').createDiv();
		this.styleEl = this.contentEl.createEl('style');

		this.processor = new MarpMarkdownProcessor(this.app,this);
		this.exporter = new MarpExporter(this.app);
		this.progressBar = new ProgressBarComponent(this.progressBarEl);
		this.progressBar.setValue(0);
	}

	getViewType(): string {
		return MARP_PREVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return `Marp Preview ${this.file?.path ?? ''}`;
	}


	async renderPreview(pageInfo: readonly MarpSlidePageInfo[]) {
		if (this.markdownCache.length !== pageInfo.length) {
			this.markdownCache = new Array(pageInfo.length);
		}
		console.log("renderPreview", pageInfo);
		for (const info of pageInfo) {
			if (info.isUpdate || this.markdownCache[info.page] === undefined) {
				//様々な変換を行う
				const markdown = await this.processor.process(info, true);
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
		const pages = await Promise.all(pageInfo.map(info => this.processor.process(info, false)))
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
			if (!this.file) return
			const progress = (value: number, msg?: string) => {
				this.progressBar.setValue(value);
				if (msg) new Notice(msg, 2000);
			};
			const pageInfo = getMarpPageInfo(this.file);
			const markdown = await this.prepareExport(pageInfo);
			progress(20);
			const buffer = await this.exporter.exportPdf(markdown, progress);
			progress(100);
			this.downloadFile(buffer, this.file.basename + '.pdf', 'application/pdf');
			setTimeout(() => this.progressBar.setValue(0), 5000);
		});
		this.addAction('refresh-cw', 'Refresh Preview', () => {
			if (this.file) {
				this.renderPreview(getMarpPageInfo(this.file));
			}
		});
	}

	async onOpen() {
		//this.registerEvent(this.app.vault.on('modify', this.onChange.bind(this)));
		this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
		this.registerDomEvent(this.containerEl, 'click', (e) => {
			const clicked = e.target as HTMLElement;
			if(clicked.tagName.toLocaleLowerCase() === "img"){
				//download image
				const src = clicked.getAttribute("src");
				if(src){
					const a = document.createElement('a');
					a.href = src;
					a.download = src.split('/').at(-1) ?? "image";
					a.click();
				}
				return;
			}
			//svgまで遡る
			const svg = clicked.closest('svg');
			if (svg && this.file) {
				const allSlides = this.bodyEl.querySelectorAll('.marpit > svg');
				const page = Array.from(allSlides).indexOf(svg);
				emitMarpSlideState(this.file, { page, setBy: "preview" });
			}
		})
		//this.registerEvent(this.app.workspace.on('editor-change', this.onEditorChange.bind(this)));
		this.addActions();
		this.progressBar.setValue(0);
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
			this.register(
				subscribeMarpSlideContent(state.file, (content) => {
					this.renderPreview(content.pageInfo);
				})
			);
			this.register(subscribeMarpSlideState(state.file, (state) => {
				if (state.setBy === "preview") return;
				this.moveCursorToPage(state.page);
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
