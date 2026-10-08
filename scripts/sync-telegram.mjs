import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const token = process.env.TELEGRAM_BOT_TOKEN;
const expectedUsername = (process.env.TELEGRAM_USERNAME || 'Takigos').replace(/^@/, '').toLowerCase();
const profilePath = path.join(root, 'data', 'telegram-profile.json');
const assetsPath = path.join(root, 'assets');
const tracksPath = path.join(assetsPath, 'tracks');

if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN secret.');

const api = async (method, parameters = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parameters)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  return result.result;
};

const extensionFor = (fileName = '', mimeType = '') => {
  const extension = path.extname(fileName).toLowerCase();
  if (['.mp3', '.m4a', '.ogg', '.wav', '.aac'].includes(extension)) return extension;
  return ({ 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/aac': '.aac' })[mimeType] || '.mp3';
};

const download = async (fileId, destination) => {
  const file = await api('getFile', { file_id: fileId });
  if (!file.file_path) throw new Error('Telegram did not return a file path.');
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Could not download Telegram file (${response.status}).`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return file.file_path;
};

const updates = await api('getUpdates', { allowed_updates: ['message'], timeout: 0 });
const update = [...updates].reverse().find(({ message }) => message?.chat?.type === 'private' && message.from?.username?.toLowerCase() === expectedUsername);
if (!update) throw new Error(`Open the bot from @${expectedUsername}, press Start, then run this workflow again.`);
const userId = update.message.from.id;

const [chat, photos, profileAudios] = await Promise.all([
  api('getChat', { chat_id: userId }),
  api('getUserProfilePhotos', { user_id: userId, limit: 1 }),
  api('getUserProfileAudios', { user_id: userId, offset: 0, limit: 10 })
]);

await mkdir(assetsPath, { recursive: true });
await mkdir(tracksPath, { recursive: true });

let avatar = null;
const photoSizes = photos.photos?.[0];
if (photoSizes?.length) {
  const largest = [...photoSizes].sort((first, second) => (second.file_size || second.width * second.height) - (first.file_size || first.width * first.height))[0];
  await download(largest.file_id, path.join(assetsPath, 'telegram-avatar.jpg'));
  avatar = 'assets/telegram-avatar.jpg';
}

const savedFiles = new Set();
const tracks = [];
for (const audio of profileAudios.audios || []) {
  const size = audio.file_size || 0;
  const extension = extensionFor(audio.file_name, audio.mime_type);
  const fileName = `${audio.file_unique_id}${extension}`;
  const destination = path.join(tracksPath, fileName);
  let src = null;
  if (size > 0 && size <= 20 * 1024 * 1024) {
    await download(audio.file_id, destination);
    savedFiles.add(fileName);
    src = `assets/tracks/${fileName}`;
  }
  tracks.push({ title: audio.title || audio.file_name || 'Без названия', artist: audio.performer || 'Telegram', duration: audio.duration || null, src });
}

for (const entry of await readdir(tracksPath)) {
  if (!savedFiles.has(entry)) await rm(path.join(tracksPath, entry), { force: true });
}

await writeFile(profilePath, `${JSON.stringify({
  name: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'Taki',
  username: chat.username ? `@${chat.username}` : `@${expectedUsername}`,
  bio: chat.bio || '',
  avatar,
  tracks
}, null, 2)}\n`);
console.log(`Synced ${tracks.length} Telegram track(s).`);
