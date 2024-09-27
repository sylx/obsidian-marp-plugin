import { atom, map, onMount, subscribeKeys } from "nanostores";
import { TFile } from "obsidian";

export type MarpSlidePageInfo = {
    page: number;
    start: number;
    end: number;
    content: string;
    isUpdate?: boolean;
	sourcePath: string;
};

export type MarpSlideContent = {
	pageInfo: MarpSlidePageInfo[];
	styleMd: TFile[];
	css: string;
	mermaidCommon: string;
}

export type MarpSlideState = {
	page: number;
	setBy: "preview" | "editor";
};

export const getMarpPageInfo = (file: TFile) => {
	return getMarpSlideContent(file)?.pageInfo ?? [];
}

export const setMarpPageInfo = (file: TFile,info: MarpSlidePageInfo[]) => {
	const old = getMarpSlideContent(file) ?? {pageInfo: [],styleMd: [],css: "",mermaidCommon: ""};
	emitMarpSlideContent(file,{...old,pageInfo: info.map(i=>({...i,isUpdate: true}))});
}

export const mergeMarpPageInfo =  (file: TFile,partialInfo: MarpSlidePageInfo[]) => {
	const pageInfo = getMarpSlideContent(file)?.pageInfo ?? [];
	let addOffset = 0;
    const newInfo = pageInfo.map(oldInfo => {
        const newPage = partialInfo.find(partial => partial.page === oldInfo.page)
        if(newPage){
            const current =  {...newPage,start: newPage.start + addOffset,end: newPage.end + addOffset,isUpdate: true};
            addOffset += current.end - oldInfo.end;
            return current;
        } else {
            return {...oldInfo,start: oldInfo.start + addOffset,end: oldInfo.end + addOffset,isUpdate: false};
        }     
    })
	const old = getMarpSlideContent(file) ?? {pageInfo: [],styleMd: [],css: "",mermaidCommon: ""};
    emitMarpSlideContent(file,{...old,pageInfo: newInfo});
}

const marpSlideStateMap = map<Record<TFile["path"],MarpSlideState>>();

export const subscribeMarpSlideState = (file: TFile,cb: (state:MarpSlideState) => void) => {
	return subscribeKeys(marpSlideStateMap,[file.path],(record) => {
		const state = record[file.path];
		if(state) cb(state);
	});
}

export const emitMarpSlideState = (file: TFile,state: MarpSlideState) => {
	marpSlideStateMap.setKey(file.path,state);
}

export const getMarpSlideState = (file: TFile) => {
	const r=marpSlideStateMap.get()
	return r[file.path];
}

const marpSlideContentMap = map<Record<TFile["path"],MarpSlideContent>>();

export const subscribeMarpSlideContent = (file: TFile,cb: (content:MarpSlideContent) => void) => {
	return subscribeKeys(marpSlideContentMap,[file.path],(record) => {
		const content = record[file.path];
		if(content) cb(content);
	});
}

export const emitMarpSlideContent = (file: TFile,value: any) => {
	marpSlideContentMap.setKey(file.path,value);
}

export const getMarpSlideContent = (file: TFile) => {
	const r=marpSlideContentMap.get()
	return r[file.path] ?? null;
}
