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

export type MarpSlideState = {
	page: number;
	setBy: "preview" | "editor";
};

type MarpSlidePageInfoStore = ReturnType<typeof atom<MarpSlidePageInfo[]>>;

const marpSlideInfoStoreMap = new Map<TFile, MarpSlidePageInfoStore>();

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

const marpSlidePageNumberStateMap = map<Record<TFile["path"],MarpSlideState>>();

export const subscribeMarpSlideState = (file: TFile,cb: (state:MarpSlideState) => void) => {
	return subscribeKeys(marpSlidePageNumberStateMap,[file.path],(record) => {
		const state = record[file.path];
		if(state) cb(state);
	});
}

export const emitMarpSlideState = (file: TFile,state: MarpSlideState) => {
	marpSlidePageNumberStateMap.setKey(file.path,state);
}

export const getMarpSlideState = (file: TFile) => {
	const r=marpSlidePageNumberStateMap.get()
	return r[file.path];
}
