import { on } from "events";
import { atom, onMount } from "nanostores";
import { TFile } from "obsidian";

export type MarpSlidePageInfo = {
    page: number;
    start: number;
    end: number;
    content: string;
    isUpdate?: boolean;
};

type MarpSlidePageInfoStore = ReturnType<typeof atom<MarpSlidePageInfo[]>>;
type MarpSlideCurrentPage = ReturnType<typeof atom<number>>;

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
    const $page = atom(0);
    onMount($page,()=>{
        console.log("onMount page",file.path);
        return () => {
            console.log("onUnmount page",file.path);
        }
    })
    marpSlideCurrentPage.set(file,$page);
    return $page;
}

export const setCurrentPage = (file: TFile,page: number) => {
    const $page = createOrGetCurrentPageStore(file);
    $page.set(page);
}
export const getCurrentPage = (file: TFile) => {
    const $page = createOrGetCurrentPageStore(file);
    return $page.get();
}