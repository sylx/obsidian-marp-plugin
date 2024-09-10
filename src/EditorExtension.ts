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
import { App, TFile } from "obsidian";
import { mergeMarpPageInfo, setCurrentPage, setMarpPageInfo,MarpSlidePageInfo, createOrGetCurrentPageStore } from "./store";

export class EditorExtensionPluginValue implements PluginValue {
  decorations: DecorationSet | undefined;
  file: TFile | null = null;
  app: App;
  pageInfo: MarpSlidePageInfo[] = [];
  unsubscribe: any[] = [];
  
  constructor(view: EditorView,app: App) {
    // ファイルを開いた時、別のファイルに移った時再生成される
    console.log('MEditorExtensionPlugin instantiated',{view,app});
    this.app = app;
    this.pageInfo=this.createPageInfo(view.state);
    this.file = this.app.workspace.getActiveFile();
    
    //subscribe
    if(this.file){
      const $page = createOrGetCurrentPageStore(this.file);
      this.unsubscribe.push($page.subscribe((page)=>{
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
    if(this.pageInfo.length < page) return;
    const currentPos = view.state.selection.main.from
    const targetPageInfo = this.pageInfo[page];
    if(currentPos < targetPageInfo.start || currentPos > targetPageInfo.end){
      view.dispatch({
        selection: {
          anchor: targetPageInfo.end,
          head: targetPageInfo.start
        },
        effects: EditorView.scrollIntoView(targetPageInfo.start,{
          y: "center"
        })
      })
      //focus
      view.focus();
    }
  }
  update(update: ViewUpdate) {
    this.file = this.app.workspace.getActiveFile();
    if(update.docChanged){
      const newPageInfo = this.createPageInfo(update.state);
      const pagesOrFalse = this.detectUpdatePages(newPageInfo);
      console.log('update',pagesOrFalse);
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
    tree.iterate({
      enter: node=>{
        console.log(node.type,state.sliceDoc(node.from,node.to));
        if(node.type.name === 'hr'){
          newPageInfo.push({
            page: newPageInfo.length,
            start: last_offset,
            end: node.from,
            content: state.sliceDoc(last_offset,node.from),
            isUpdate: true
          })
          last_offset = node.to;
        }
      }
    })
    console.log(tree);

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

