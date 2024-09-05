import {
  ViewUpdate,
  PluginSpec,
  PluginValue,
  EditorView,
  ViewPlugin,
  Decoration,
  DecorationSet
} from "@codemirror/view";
import { getPreviewView } from "./preview";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { App } from "obsidian";

export type PageInfo = {
  page: number; // 0 origin
  start: number;
  end: number;
  content: string;
}

export class EditorExtensionPluginValue implements PluginValue {
  decorations: DecorationSet | undefined;
  app: App;
  pageInfo: PageInfo[] = [];  
  
  constructor(view: EditorView,app: App) {
    // ファイルを開いた時、別のファイルに移った時再生成される
    console.log('MEditorExtensionPlugin instantiated',{view,app});
    this.app = app;
    this.pageInfo=this.createPageInfo(view.state);
    this.renderPreview(this.pageInfo,true);
  }

  // previewViewに対する通知
  renderPreview(pageInfo: PageInfo[],notPagrtial?:boolean){
    getPreviewView(this.app.workspace)?.renderPreview(pageInfo,notPagrtial);
  }
  moveCursorToPage(page: number){
    getPreviewView(this.app.workspace)?.moveCursorToPage(page);
  }

  update(update: ViewUpdate) {    
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
          this.moveCursorToPage(info.page);
        }
      })
    }
  }

  createPageInfo(state: EditorState){
    // markdownの---を探す
    let last_offset : number = 0;
    const newPageInfo: PageInfo[] = [];
    syntaxTree(state).iterate({
      enter: node=>{
        if(node.type.name === 'hr'){
          newPageInfo.push({
            page: newPageInfo.length,
            start: last_offset,
            end: node.from,
            content: state.sliceDoc(last_offset,node.from)
          })
          last_offset = node.to;
        }
      }
    })
    if(last_offset < state.doc.length){
      newPageInfo.push({
        page: newPageInfo.length,
        start: last_offset,
        end: state.doc.length,
        content: state.sliceDoc(last_offset,state.doc.length)
      })
    }
    return newPageInfo;
  }
  detectUpdatePages(pageInfo: PageInfo[]){
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
    console.log('EditorExtensionPlugin destroyed');
  }
}

export const pluginSpec: PluginSpec<EditorExtensionPluginValue> = {
  decorations: (value: EditorExtensionPluginValue) => value.decorations ?? Decoration.none,
};

