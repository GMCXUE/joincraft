export type PackFile={path:string;sha512:string;size:number};
export function packManifest(pack:any):PackFile[];
export function packDiff(before:PackFile[],after:PackFile[]):{added:PackFile[];removed:PackFile[];changed:PackFile[]};
