import { App, FileSystemAdapter, getLinkpath } from "obsidian";
import { MarpSlidePageInfo } from "./store";
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { Code, Parent, Root } from "mdast-util-from-markdown/lib";
import { visit } from "unist-util-visit";
import { Image, Text, Node, RootContent } from "mdast";
import mimes from 'mime';
import { convertToDataUrlFromPath, convertToDataUrlFromUrl,convertMermaidToDataUrl } from "./convertImage";
import { getFilePathByLinkPath, getResourcePathByFullPath } from "./tools";
import { normalize } from "path";
import { marp } from "./marp";

type ReplaceAction = {parent: Parent, index: number, node: Node};
type ReplaceActionPromise = Promise<ReplaceAction | null>;

const transformAsync = async (root: Node,type: string,transformer: (node: Node) => Promise<Node | null>): Promise<Node> => {
	const transformPromises : ReplaceActionPromise[] = [];
	visit(root,type,(node,index,parent) => {
		if(!parent) return;
		const promise = transformer(node).then((newNode) => {
			if(newNode){
				return {parent,index,node:newNode}
			}
			return null;
		}) as ReplaceActionPromise;
		transformPromises.push(promise);
	});
	const replaced = (await Promise.all(transformPromises)).filter(Boolean) as ReplaceAction[];
	replaced.forEach((action,index) => {
		if(action){
			action.parent.children.splice(action.index,1,action.node as RootContent);
		}
	});
	return root
}

export class MarpMarkdownProcessor {
	constructor(
		protected readonly app: App
	) {
	}

	async process(pageInfo: MarpSlidePageInfo,isPreview: boolean): Promise<string> {
		const tree = fromMarkdown(pageInfo.content);
		await this.convertWikiLinkToImage(tree);
		await this.convertImageStyle(tree);
		if(isPreview){
			await this.convertImageToResourcePath(tree,pageInfo.sourcePath);
		}else{
			await this.convertImageToDataUrl(tree,pageInfo.sourcePath);
		}
		await this.mermaidCodeToHtmlImg(tree);
		const markdown = toMarkdown(tree);
		console.log({
			tree,
			before: pageInfo.content,
			after: markdown
		})
		return markdown;
	}

	/**
	 * obsidianの画像スタイルをmarpのスタイルに変換する
	 * 
	 * @param tree 
	 * @see https://help.obsidian.md/Linking+notes+and+files/Embed+files
	 * @see https://marpit.marp.app/image-syntax?id=resizing-image
	 */
	protected async convertImageStyle(tree: Root): Promise<void> {
		await transformAsync(tree, 'image', async (node: Image) => {
			let alt = node.alt ?? "image";
			if(alt.match(/^\d+$/)){
				alt=`w:${alt}`;
			}else if(alt.match(/^\d+x\d+$/)){
				alt=`w:${alt.split("x")[0]} h:${alt.split("x")[1]}`;
			}
			return {
				...node,
				alt
			} as Node
		})
	}

	protected async convertWikiLinkToImage(tree: Root): Promise<void> {
		// ![[url(|alt)]]形式のノードを探して通常の画像ノードに変換する
		await transformAsync(tree, 'text', async (node : Text) => {
			const match = node.value.match(/^!\[\[(.*?)\]\]$/)
			if (match){
				let alt="image"
				let filename = match[1];
				if(filename && filename.includes("|")){
					[filename,alt] = filename.split("|");
				}
				const imageNode: Image = {
					type: 'image',
					url: filename,
					alt: alt,
				}
				return imageNode;
			}
			return null
		})
	}
	protected async convertImageToDataUrl(tree: Root,sourcePath: string): Promise<void> {
		await transformAsync(tree, 'image', async (node: Image) => {
			if(node.url.startsWith("data:")){
				return null;
			}else if(node.url.startsWith("http")){
				const dataurl =  await convertToDataUrlFromUrl(node.url)
				return {
					...node,
					url: dataurl,
				} as Node;
			}else if(node.url.startsWith("file:///")){
				const fullpath = normalize(node.url.replace("file:///",""))
				const dataurl = await convertToDataUrlFromPath(fullpath)
				return {
					...node,
					url: dataurl,
				} as Node;
			}else{
				const fullpath = await getFilePathByLinkPath(this.app,node.url,sourcePath)
				if(!fullpath) return null;
				const dataurl = await convertToDataUrlFromPath(fullpath)
				return dataurl ? {
					...node,
					url: dataurl,
				} as Node : null;
			}
		})
	}
	protected async convertImageToResourcePath(tree: Root,sourcePath: string): Promise<void> {
		await transformAsync(tree, 'image', async (node: Image) => {
			if(node.url.startsWith("data:")){
				return null;
			}else if(node.url.startsWith("http")){
				return null;
			}else if(node.url.startsWith("file:///")){
				const fullpath = node.url.replace("file:///","")
				// 奇妙な変換を行うことで表示が可能になる。しかしこれはobsidianのbugかもしれない
				const baseResourcePath = this.app.vault.adapter.getResourcePath("").replace(/^app:\/\/.+?\/(.+?)\?.+$/,"$1/")
				const dataurl = this.app.vault.adapter.getResourcePath(fullpath).replace(baseResourcePath,"")
				return {
					...node,
					url: dataurl,
				} as Node;
			}else{
				const dataurl = await getResourcePathByFullPath(this.app,node.url)
				return dataurl ? {
					...node,
					url: dataurl,
				} as Node : null;
			}
		})		
	}
	protected async mermaidCodeToHtmlImg(tree: Root): Promise<void> {
		await transformAsync(tree, 'code', async (node: Code) => {
			if(node.lang !== "mermaid") return null;
			const code = node.value;
			const dataurl = await convertMermaidToDataUrl(code);
			if(!dataurl) return null;
			const htmlNode = {
				type: 'html',
				value: `<img src="${dataurl}" alt="mermaid" />`
			} as Node;
			return htmlNode;
		});
	}
	protected pickupNode(tree: Root,matcher: (node: Node) => boolean): Node | null {
		let matched: Node | null = null;
		visit(tree, matcher, (node) => {
			matched = node;
		});
		return matched;
	}
}
