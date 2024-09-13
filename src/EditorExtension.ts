import {
  ViewUpdate,
  PluginSpec,
  PluginValue,
  EditorView,
  ViewPlugin,
  Decoration,
  DecorationSet
} from "@codemirror/view";
import { getPreviewView, getPreviewViewByFile } from "./preview";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { App, EditorPosition, EditorRange, MarkdownView, Plugin, TFile, View } from "obsidian";
import { mergeMarpPageInfo, setCurrentPage, setMarpPageInfo,MarpSlidePageInfo, createOrGetCurrentPageStore } from "./store";
import { SyntaxNodeRef } from "@lezer/common";

export class EditorExtensionPluginValue implements PluginValue {
  decorations: DecorationSet | undefined;
  file: TFile | null = null;
  plugin: Plugin;
  app: App;
  pageInfo: MarpSlidePageInfo[] = [];
  unsubscribe: any[] = [];
  globalMarkdownView: MarkdownView | null = null;
  cursorMoving: boolean = false;
  
  constructor(view: EditorView,plugin: Plugin) {
	this.plugin = plugin;
	this.app = plugin.app;
    // ファイルを開いた時、別のファイルに移った時再生成される
    console.log('MEditorExtensionPlugin instantiated',{view,app});
    this.app = app;
    this.pageInfo=this.createPageInfo(view.state);
    this.file = this.app.workspace.getActiveFile();
	this.globalMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    
    //subscribe
    if(this.file){
      const $page = createOrGetCurrentPageStore(this.file);
      this.unsubscribe.push($page.subscribe(({page,setBy},oldVal)=>{
		if(!oldVal) return;
		if(setBy === "editor") return;
        this.moveEditorCursor(view,page);
      }));
    }
    //previewがあれば更新
    this.renderPreview(this.pageInfo,true);
  }

  // previewViewに対する通知
  renderPreview(pageInfo: MarpSlidePageInfo[],notPagrtial?:boolean){
    if(!this.file) return;
    notPagrtial ? setMarpPageInfo(this.file,pageInfo) : mergeMarpPageInfo(this.file,pageInfo);
  }
  movePreviewCursor(page: number){
    if(!this.file) return;
    setCurrentPage(this.file,page);
  }
  moveEditorCursor(view: EditorView,page: number){
	this.cursorMoving = true;
	const markdownView = this.getCurrentViewOfType();
    const targetPageInfo = this.pageInfo[page];
	if(!markdownView || !targetPageInfo) return;
	const editor = markdownView.editor
	const pos : EditorPosition = page > 0 ?{
		ch: 0,
		line: view.state.doc.lineAt(targetPageInfo.start).number + 1
	}  : {
		ch: 0,
		line: 0
	}
	editor.setCursor(pos);
	editor.focus();
	this.cursorMoving = false;
  }
  public getCurrentViewOfType() {
	// get the current active view
	let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
	// To distinguish whether the current view is hidden or not markdownView
	let currentView = this.app.workspace.getActiveViewOfType(View) as MarkdownView;
	// solve the problem of closing always focus new tab setting
	if (markdownView !== null) {
		this.globalMarkdownView = markdownView;
	} else {
		// fix the plugin shutdown problem when the current view is not exist
		if (currentView == null || currentView?.file?.extension == "md") {
			markdownView = this.globalMarkdownView
		}
	}
	return markdownView;
  }  
  update(update: ViewUpdate) {
	if(this.cursorMoving) return;
    this.file = this.app.workspace.getActiveFile();
    if(update.docChanged){
      const newPageInfo = this.createPageInfo(update.state);
      const pagesOrFalse = this.detectUpdatePages(newPageInfo);
      if(pagesOrFalse === false){
        //検出不可なので、全部更新
        this.renderPreview(newPageInfo,true);
      }else if(pagesOrFalse.length > 0){
        this.renderPreview(pagesOrFalse);
      }
      this.pageInfo = newPageInfo;
    }else if(!update.focusChanged && !update.viewportChanged){
      // カーソル移動
      const selection = update.state.selection.main;
      const offset = selection.head;
      this.pageInfo.forEach((info,index)=>{
        if(info.start <= offset && offset <= info.end){
          this.movePreviewCursor(info.page);
        }
      })
    }
  }

  createPageInfo(state: EditorState){
    // markdownの---を探す
    let last_offset : number = 0;
    const newPageInfo: MarpSlidePageInfo[] = [];
    const tree=syntaxTree(state)
	let last_node : SyntaxNodeRef | null = null;
    tree.iterate({
      enter: node=>{
        if(node.type.name === 'hr'){
          newPageInfo.push({
            page: newPageInfo.length,
            start: last_offset,
            end: node.from,
            content: state.sliceDoc(last_offset,node.from),
            isUpdate: true
          })
          last_offset = node.to;
        }else{
			last_node = node;
		}
      }
    })
    if(last_offset < state.doc.length){
      newPageInfo.push({
        page: newPageInfo.length,
        start: last_offset,
        end: state.doc.length,
        content: state.sliceDoc(last_offset,state.doc.length),
        isUpdate: true
      })
    }
    return newPageInfo;
  }
  detectUpdatePages(pageInfo: MarpSlidePageInfo[]){
    const oldPageInfo = this.pageInfo;
    // 基本的にcontentの比較で差異があったもののみを返す。ページの増減、増加があった場合は、全てのページを返す
    if(oldPageInfo.length !== pageInfo.length){
      return false;
    }
    const pages = [];
    for(let i = 0; i < pageInfo.length; i++){
      if(oldPageInfo[i].content !== pageInfo[i].content){
        pages.push(pageInfo[i]);
      }
    }
    return pages;
  }


  destroy() {
    // ...
    this.unsubscribe.forEach((unsub: any) => unsub());
    this.unsubscribe = [];
    console.log('EditorExtensionPlugin destroyed');
  }
}

export const pluginSpec: PluginSpec<EditorExtensionPluginValue> = {
  decorations: (value: EditorExtensionPluginValue) => value.decorations ?? Decoration.none,
};

