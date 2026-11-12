import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export class ApiError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
export function fail(message: string, status = 400): never { throw new ApiError(message, status); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('请求需要 JSON 对象');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max: number, optional = false): string {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string') fail(`${label}格式无效`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) fail(`${label}需要${optional ? '最多' : ' 1–'}${max} 个字符`);
  return result;
}
export function password(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 64) fail('密码最多 64 个字符');
  return value;
}
export async function hashPassword(value: unknown): Promise<string | null> {
  const input = password(value); if (!input) return null;
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(input, salt, 32) as Buffer).toString('hex')}`;
}
export async function verifyPassword(input: unknown, encoded: string) {
  const value = password(input); if (!value) fail('这个房间需要密码', 403);
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash) throw new Error('Invalid stored password');
  const supplied = await derive(value, salt, 32) as Buffer;
  if (!timingSafeEqual(supplied, Buffer.from(hash, 'hex'))) fail('房间密码不正确', 403);
}
function roomImage(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 350000) fail('房间图片过大');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) fail('房间图片仅支持 PNG、JPEG 或 WebP');
  const b = Buffer.from(match[2]!, 'base64');
  const valid = match[1] === 'png' && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || match[1] === 'jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255
    || match[1] === 'webp' && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) fail('图片内容与格式不匹配');
  return value;
}
export function roomFields(body: Record<string, unknown>) {
  const capacity = Number(body.capacity ?? 8);
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 32) fail('人数上限需要为 2–32 人');
  return { name: text(body.name, '房间名称', 40), capacity,
    description: text(body.description, '房间介绍', 240, true), image: roomImage(body.image) };
}
export function gameFields(body: Record<string, unknown>) {
  const version = text(body.version, '版本号', 30, true), loader = body.loader ?? '原版';
  if (typeof loader !== 'string' || !['原版', 'Fabric', 'Forge', 'NeoForge'].includes(loader)) fail('请选择游戏环境');
  const raw = body.port;
  const port = raw === undefined || raw === null || raw === '' ? null : Number(raw);
  if (typeof raw === 'boolean' || port !== null && (!Number.isInteger(port) || port < 1024 || port > 65535)) fail('端口需要为 1024–65535 的整数');
  return { version, loader, port };
}
