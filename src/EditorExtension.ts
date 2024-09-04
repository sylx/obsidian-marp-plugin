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

export class EditorExtensionPluginValue implements PluginValue {
  decorations: DecorationSet | undefined;
  previewView: PreviewView | undefined;
  offsetMap: [number, number][] = [];

  constructor(view: EditorView) {
    // ...
    console.log('MarpViewPlugin instantiated');
    editorExtensionInstance = this;
    this.updateOffsetMap(view.state);
  }

  setPreviewView(previewView: PreviewView | undefined) {
    this.previewView = previewView;
  }

  

  update(update: ViewUpdate) {    
    if(update.docChanged){
      this.updateOffsetMap(update.state);
    }else if(this.previewView && !update.focusChanged && !update.viewportChanged){
      // ページを割り出す
      const selection = update.state.selection.main;
      const offset = selection.head;
      this.offsetMap.forEach(([start,end],index)=>{
        if(start <= offset && offset <= end){
          this.previewView?.onCursorChange(selection,index);
        }
      })
    }
  }

  updateOffsetMap(state: EditorState){
    // markdownの---を探す
    let last_offset : number = 0;
    this.offsetMap = [];
    syntaxTree(state).iterate({
      enter: node=>{
        if(node.type.name === 'hr'){
          this.offsetMap.push([last_offset,node.from]);
          last_offset = node.to;
        }
      }
    })
    console.log("offsetMap",this.offsetMap);
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
