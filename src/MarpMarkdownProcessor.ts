import { App, Component, MarkdownPreviewRenderer, MarkdownRenderer, Plugin, TFile } from "obsidian";
import { getMarkdownEmbedCache, MarpSlidePageInfo } from "./store";
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { visit } from "unist-util-visit";
import { Image, Text, Node, RootContent, Yaml, Code, Html, Link, Parent, Root } from "mdast";
import { convertToDataUrlFromPath, convertToDataUrlFromUrl, convertMermaidToDataUrl } from "./convertImage";
import { getFilePathByLinkPath, getResourcePathByFullPath } from "./tools";
import { normalize } from "path";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from 'micromark-extension-frontmatter';
import Mime from 'mime';

type ReplaceAction = { parent: Parent, index: number, node: Node | null };
type ReplaceActionPromise = Promise<ReplaceAction | null>;

const transformAsync = async (root: Node, type: string, transformer: (node: Node) => Promise<Node | null | false>): Promise<Node> => {
	const transformPromises: ReplaceActionPromise[] = [];
	visit(root, type, (node, index, parent) => {
		if (!parent) return;
		const promise = transformer(node).then((newNode) => {
			if (newNode) {
				return { parent, index, node: newNode }
			}else if (newNode === false) {
				return { parent, index, node: null }
			}
			return null;
		}) as ReplaceActionPromise;
		transformPromises.push(promise);
	});
	const actions = (await Promise.all(transformPromises)).filter(Boolean) as ReplaceAction[];
	const action_dones : ReplaceAction[] = [];
	//置換を処理
	actions.forEach((action, index) => {
		if (action) {
			//処理済みで削除されたノードのインデックスがこのactionより前にある場合、インデックスを修正する
			const true_index = action.index - action_dones.filter((a) => a.parent === action.parent && action.node === null && a.index < action.index).length;
			if (action.node === null) {
				//remove
				action.parent.children.splice(true_index, 1);
			}else{
				//replace
				action.parent.children.splice(true_index, 1, action.node as RootContent);
			}
			action_dones.push(action);
		}
	});
	return root
}

export class MarpMarkdownProcessor {
	constructor(
		protected readonly app: App,
		protected readonly parentComponent: Component
	) {
	}

	async process(pageInfo: MarpSlidePageInfo, isPreview: boolean): Promise<string> {
		const tree = fromMarkdown(pageInfo.content, {
			extensions: [frontmatter()],
			mdastExtensions: [frontmatterFromMarkdown()]
		});
		console.log({"before": pageInfo.content, "tree": JSON.parse(JSON.stringify(tree))})
		const frontmatterYaml = pageInfo.page === 0 ? await this.removeFrontmatter(tree) : null;
		await this.convertWikiLinkToLink(tree);
		await this.convertLinkToStyle(tree,(node) => {
			return node.url.endsWith(".css");
		},pageInfo.sourcePath);
		await this.convertEmbedWikiLinkToImage(tree,pageInfo.sourcePath);
		await this.convertImageStyle(tree);
		if (isPreview) {
			await this.convertImageToResourcePath(tree, pageInfo.sourcePath);
		} else {
			//await this.convertImageToDataUrl(tree, pageInfo.sourcePath);
			await this.convertImageToLocalPath(tree, pageInfo.sourcePath);
		}
		await this.mermaidCodeToHtmlImg(tree);
		let markdown = toMarkdown(tree);
		if(frontmatterYaml){
			markdown = `---\n${frontmatterYaml.value}\n---\n${markdown}`;
		}
		console.log({
			tree,
			after: markdown
		})
		return markdown;
	}

	protected async removeFrontmatter(tree: Root): Promise<Yaml | null> {
		let frontmatterYamlNode : Node | null = null;
		await transformAsync(tree, 'yaml', async (node: Yaml) => {
			frontmatterYamlNode = node;
			return false;
		})
		return frontmatterYamlNode ? frontmatterYamlNode : null;
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
			if (alt.match(/^\d+$/)) {
				alt = `w:${alt}`;
			} else if (alt.match(/^\d+x\d+$/)) {
				alt = `w:${alt.split("x")[0]} h:${alt.split("x")[1]}`;
			}
			return {
				...node,
				alt
			} as Node
		})
	}

	protected async convertEmbedWikiLinkToImage(tree: Root,sourcePath: string): Promise<void> {
		// ![[url(|alt)]]形式のノードを探して通常の画像ノードに変換する
		await transformAsync(tree, 'text', async (node: Text) => {
			const match = node.value.match(/^!\[\[(.*?)\]\]$/)
			if (match) {
				let alt = "image"
				let filename = match[1];
				if (filename && filename.includes("|")) {
					[filename, alt] = filename.split("|");
				}				
				// image mimetype
				if(Mime.getType(filename)?.includes("image")){
					const imageNode: Image = {
						type: 'image',
						url: filename,
						alt: alt,
					}
					return imageNode;
				}else{
					const file = {
						path: sourcePath
					} as TFile; // workaround
					const embedCache = getMarkdownEmbedCache(file, filename);
					if(embedCache){
						return {
							type: 'html',
							value: embedCache
						} as Html;
					}
				}

			}
			return null
		})
	}

	protected async convertWikiLinkToLink(tree: Root): Promise<void> {
		// [[url|text]]形式のノードを探して通常のリンクノードに変換する
		await transformAsync(tree, 'text', async (node: Text) => {
			const match = node.value.match(/\!*\[\[(.*?)\]\]$/)
			if (match && !match[0].startsWith("!")) {
				let text = match[1];
				let url = text;
				if (text && text.includes("|")) {
					[url, text] = text.split("|");
				}
				const linkNode: Link = {
					type: 'link',
					url: url,
					children: [{ type: 'text', value: text }]
				}
				return linkNode;
			}
			return null
		})
	}

	protected async convertLinkToStyle(tree: Root,matcher: (node: Link) => boolean,sourcePath: string): Promise<void> {
		await transformAsync(tree, 'link', async (node: Link) => {
			if (matcher(node)) {
				const filename = node.url;
				const file = this.app.metadataCache.getFirstLinkpathDest(filename, sourcePath);
				if(!file) return null;
				const content = await this.app.vault.cachedRead(file)
				// parse markdown
				const tree = fromMarkdown(content, {
					extensions: [frontmatter()],
					mdastExtensions: [frontmatterFromMarkdown()]
				});
				// retrieve css code blocks
				const css = this.pickupAllNode(tree, (node) => {
					return node.type === "code" && (node as Code).lang === "css";
				});
				if(css.length > 0){
					const style = css.map((node) => (node as Code).value).join("\n");
					return {
						type: 'html',
						value: `<style>${style}</style>`
					} as Html;
				}
			}
			return null;
		})
	}

	protected async convertImageToDataUrl(tree: Root, sourcePath: string): Promise<void> {
		await transformAsync(tree, 'image', async (node: Image) => {
			if (node.url.startsWith("data:")) {
				return null;
			} else if (node.url.startsWith("http")) {
				const dataurl = await convertToDataUrlFromUrl(node.url)
				return {
					...node,
					url: dataurl,
				} as Node;
			} else if (node.url.startsWith("file:///")) {
				const fullpath = normalize(node.url.replace("file:///", ""))
				const dataurl = await convertToDataUrlFromPath(fullpath)
				return {
					...node,
					url: dataurl,
				} as Node;
			} else {
				const fullpath = await getFilePathByLinkPath(this.app, node.url, sourcePath)
				if (!fullpath) return null;
				const dataurl = await convertToDataUrlFromPath(fullpath)
				return dataurl ? {
					...node,
					url: dataurl,
				} as Node : null;
			}
		})
	}
	protected async convertImageToResourcePath(tree: Root, sourcePath: string): Promise<void> {
		await transformAsync(tree, 'image', async (node: Image) => {
			if (node.url.startsWith("data:")) {
				return null;
			} else if (node.url.startsWith("http")) {
				return null;
			} else if (node.url.startsWith("file:///")) {
				const fullpath = node.url.replace("file:///", "")
				// 奇妙な変換を行うことで表示が可能になる。しかしこれはobsidianのbugかもしれない
				const baseResourcePath = this.app.vault.adapter.getResourcePath("").replace(/^app:\/\/.+?\/(.+?)\?.+$/, "$1/")
				const dataurl = this.app.vault.adapter.getResourcePath(fullpath).replace(baseResourcePath, "")
				return {
					...node,
					url: dataurl,
				} as Node;
			} else {
				const dataurl = await getResourcePathByFullPath(this.app, node.url)
				return dataurl ? {
					...node,
					url: dataurl,
				} as Node : null;
			}
		})
	}
	protected async convertImageToLocalPath(tree: Root, sourcePath: string): Promise<void> {	
		await transformAsync(tree, 'image', async (node: Image) => {
			if (node.url.startsWith("data:")) {
				return {
					type: "html",
					value: `<img src="${node.url}" alt="${node.alt}" />`
				} as Node;				
			} else if (node.url.startsWith("http")) {
				return null;
			} else if (node.url.startsWith("file:///")) {
				const fullpath = node.url.replace("file:///", "")
				return {
					...node,
					url: fullpath,
				} as Node;
			} else {
				const fullpath = await getFilePathByLinkPath(this.app, node.url, sourcePath)
				return fullpath ? {
					...node,
					url: fullpath.replace(/\\/g, "/"),
				} as Node : null;
			}
		})
	}	
	protected async mermaidCodeToHtmlImg(tree: Root): Promise<void> {
		await transformAsync(tree, 'code', async (node: Code) => {
			if (node.lang !== "mermaid") return null;
			const code = node.value;
			try {
				const dataurl = await convertMermaidToDataUrl(code);
				if (!dataurl) return null;
				const style = node.meta ? this.metaToStyle(node.meta) : "";
				return {
					type: 'html',
					value: `<img src="${dataurl}" alt="mermaid" class="mermaid-image" ${style} />`
				} as Html;
			} catch (e) {
				return {
					type: 'html',
					value: `<pre class="mermaid-error">${e}</pre>`
				} as Html;
			}
		});
	}
	protected pickupNode(tree: Root, matcher: (node: Node) => boolean): Node | null {
		let matched: Node | null = null;
		visit(tree, matcher, (node) => {
			matched = node;
		});
		return matched;
	}
	protected pickupAllNode(tree: Root, matcher: (node: Node) => boolean): Node[] {
		const matched: Node[] = [];
		visit(tree, matcher, (node) => {
			matched.push(node);
		});
		return matched;
	}

	/** 
	 * ```mermaid 200 -> style="width: 200px"
	 * ```mermaid 200x300 -> style="width: 200px; height: 300px"
	 * ```mermaid w:200 -> style="width: 200px"* 
	 * ```mermaid h:200 -> style="height: 200px"
	*/
	protected metaToStyle(meta: string): string {
		const style: string[] = [];
		const match = meta.match(/(w|h):(\d+)/);
		if (match) {
			if (match[1] === "w") {
				style.push(`width: ${match[2]}px`);
			} else {
				style.push(`height: ${match[2]}px`);
			}
		} else {
			const [width, height] = meta.split("x");
			if (width) {
				style.push(`width: ${width}px`);
			}
			if (height) {
				style.push(`height: ${height}px`);
			}
		}
		return style.length > 0 ? `style="${style.join("; ")}"` : "";

	}
}
