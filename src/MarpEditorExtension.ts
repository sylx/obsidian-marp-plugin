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


export class MarpEditorExtension implements PluginValue {
  decorations: DecorationSet | undefined;
  editorView: EditorView;

  constructor(view: EditorView) {
    // ...
    console.log('MarpViewPlugin instantiated');
    this.editorView = view;
  }


  update(update: ViewUpdate) {    
    if(update.docChanged || update.viewportChanged || update.focusChanged) return
  }

  destroy() {
    // ...
    console.log('MarpViewPlugin destroyed');
  }
}

const pluginSpec: PluginSpec<MarpEditorExtension> = {
  decorations: (value: MarpEditorExtension) => value.decorations ?? Decoration.none,
};


export const marpEditorExtension = ViewPlugin.fromClass(MarpEditorExtension, pluginSpec);
