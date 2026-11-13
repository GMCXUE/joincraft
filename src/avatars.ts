import {createHash} from 'node:crypto';
export const avatarIds=['zombie','skeleton','creeper','enderman','pig','cow','fox','wolf','cat','chicken'] as const;
export function avatarFor(id:string,value?:string|null):string {
 return avatarIds.includes(value as typeof avatarIds[number]) ? value! : avatarIds[createHash('sha256').update(id).digest()[0]! % avatarIds.length]!;
}
