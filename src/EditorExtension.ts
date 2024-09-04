import {
    ViewUpdate,
    PluginSpec,
    PluginValue,
    EditorView,
    ViewPlugin,
    Decoration,
    DecorationSet
  } from "@codemirror/view";
import { PreviewView } from "./preview";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export let editorExtensionInstance: EditorExtensionPluginValue | undefined;

export type PageInfo = {
  page: number; // 0 origin
  start: number;
  end: number;
  content: string;
}

export class EditorExtensionPluginValue implements PluginValue {
  decorations: DecorationSet | undefined;
  previewView: PreviewView | undefined;
  pageInfo: PageInfo[] = [];
  
  constructor(view: EditorView) {
    // ...
    console.log('MarpViewPlugin instantiated');
    editorExtensionInstance = this;
    this.pageInfo=this.createPageInfo(view.state);
  }

  setPreviewView(previewView: PreviewView | undefined) {
    let isChanged = false;
    if(previewView && this.previewView !== previewView) isChanged = true;
    this.previewView = previewView;
    if(isChanged){
      this.previewView?.renderPreview(this.pageInfo,true);
    }
  }

  update(update: ViewUpdate) {    
    if(update.docChanged){
      const newPageInfo = this.createPageInfo(update.state);
      const pagesOrFalse = this.detectUpdatePages(newPageInfo);
      console.log('update',pagesOrFalse);
      if(pagesOrFalse === false){
        //検出不可なので、全部更新
        this.previewView?.renderPreview(newPageInfo,true);
      }else if(pagesOrFalse.length > 0){
        this.previewView?.renderPreview(pagesOrFalse);
      }
      this.pageInfo = newPageInfo;
    }else if(this.previewView && !update.focusChanged && !update.viewportChanged){
      // ページを割り出す
      const selection = update.state.selection.main;
      const offset = selection.head;
      this.pageInfo.forEach((info,index)=>{
        if(info.start <= offset && offset <= info.end){
          this.previewView?.onCursorChange(selection,info.page);
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
    console.log('MarpViewPlugin destroyed');
    editorExtensionInstance = undefined;
  }
}

const pluginSpec: PluginSpec<EditorExtensionPluginValue> = {
  decorations: (value: EditorExtensionPluginValue) => value.decorations ?? Decoration.none,
};


export const marpEditorExtension = ViewPlugin.fromClass(EditorExtensionPluginValue, pluginSpec);
