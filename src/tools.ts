import { App, FileSystemAdapter } from "obsidian";
import { join, normalize } from "path";

/**
 * linkとして指定されたパスのファイル実体のパスを取得する
 * @param app 
 * @param linkPath 
 * @param sourcePath 
 * @note ファイルが見つからない場合は空文字を返す
 * @note vaultがローカルファイルシステムの場合のみ動作する
 * @returns linkとして指定されたパスのファイル実体のフルパス
 */
export const getFilePathByLinkPath = async (app: App,linkPath: string,sourcePath: string): Promise<string> => {
	const file = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
	if (!file) {
		console.error(`File ${linkPath} not found`);
		return '';
	}
	const basePath = (
        app.vault.adapter as FileSystemAdapter
    ).getBasePath();
	return normalize(join(basePath,file.path))
}

/**
 * Vault内のパスをリンクパスに変換する
 * @param app 
 * @param path 
 * @returns 
 */
export const getResourcePathByFullPath = async (app: App,path: string): Promise<string> => {
	if (await app.vault.adapter.exists(path)) {
		return app.vault.adapter.getResourcePath(path);
	}
	return '';
}
