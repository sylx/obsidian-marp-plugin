import { atom, map, onMount } from "nanostores";
import { TFile } from "obsidian";
import { SyntaxNodeRef } from "@lezer/common";

export type MarpSlidePageInfo = {
    page: number;
    start: number;
    end: number;
    content: string;
    isUpdate?: boolean;
	sourcePath: string;
};

export type MarpSlidePageNumberState = {
	page: number;
	setBy: "preview" | "editor";
};

type MarpSlidePageInfoStore = ReturnType<typeof atom<MarpSlidePageInfo[]>>;
type MarpSlideCurrentPage = ReturnType<typeof map<MarpSlidePageNumberState>>;

const marpSlideInfoStoreMap = new Map<TFile, MarpSlidePageInfoStore>();
const marpSlideCurrentPage = new Map<TFile, MarpSlideCurrentPage>();

export const createOrGetMarpSlideInfoStore = (file: TFile) : MarpSlidePageInfoStore => {
    if(marpSlideInfoStoreMap.has(file)){
        return marpSlideInfoStoreMap.get(file)!;
    }
    const $store : MarpSlidePageInfoStore = atom<MarpSlidePageInfo[]>([]);
    onMount($store,()=>{
        console.log("onMount",file.path);
        return () => {
            console.log("onUnmount",file.path);
        }
    })
    marpSlideInfoStoreMap.set(file,$store);
    return $store;
}

export const getMarpPageInfo = (file: TFile) => {
	const store = createOrGetMarpSlideInfoStore(file);
	return store.get();
}

export const setMarpPageInfo = (file: TFile,info: MarpSlidePageInfo[]) => {
    const store = createOrGetMarpSlideInfoStore(file);
    store.set(info.map(info=>({...info,isUpdate: true})));
}

export const mergeMarpPageInfo =  (file: TFile,partialInfo: MarpSlidePageInfo[]) => {
    const store = createOrGetMarpSlideInfoStore(file);
    let addOffset = 0;
    const newInfo = store.get().map(oldInfo => {
        const newPage = partialInfo.find(partial => partial.page === oldInfo.page)
        if(newPage){
            const current =  {...newPage,start: newPage.start + addOffset,end: newPage.end + addOffset,isUpdate: true};
            addOffset += current.end - oldInfo.end;
            return current;
        } else {
            return {...oldInfo,start: oldInfo.start + addOffset,end: oldInfo.end + addOffset,isUpdate: false};
        }     
    })
    store.set(newInfo);
}

export const createOrGetCurrentPageStore = (file: TFile) => {
    if(marpSlideCurrentPage.has(file)){
        return marpSlideCurrentPage.get(file)!;
    }
    const $page = map<MarpSlidePageNumberState>({page: 0,setBy: "preview"} );
    onMount($page,()=>{
        console.log("onMount page",file.path);
        return () => {
            console.log("onUnmount page",file.path);
        }
    })
    marpSlideCurrentPage.set(file,$page);
    return $page;
}

export const setCurrentPage = (file: TFile,page: number,setBy: MarpSlidePageNumberState["setBy"] = "editor") => {
	console.log("setCurrentPage",file.path,page,setBy);
    const $page = createOrGetCurrentPageStore(file);
    $page.set({
		page,
		setBy
	});
}
export const getCurrentPage = (file: TFile) => {
    const $page = createOrGetCurrentPageStore(file);
    return $page.get().page;
}
