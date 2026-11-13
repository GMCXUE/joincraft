export const MAX_PACK_BYTES:number;
export type PackSummary={sha512:string;name:string;versionId:string;minecraft:string;loader:string;loaderVersion:string;archiveSize:number;totalBytes:number};
export function packURL(value:string):string;
export function packPath(value:string):string;
export function inspectMrpack(buffer:Buffer,options?:{overrides?:boolean}):Promise<PackSummary & Record<string,any>>;
export function packSummary(pack:PackSummary):PackSummary;
export function destination(root:string,relative:string):string;
