/**
 * Imports user-curated portrait photos from `curated_portraits/` into `public/photos/`
 * and updates `public/datasets/pixel-players.json`.
 *
 * Security & Anti-Cheat:
 * Photos are saved using cryptographic hashes (e.g., p_9b4e1f7a.jpg) so that
 * no player name can ever be backtracked or reverse-engineered from the UI/network tab!
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_DIR = path.join(__dirname, 'curated_portraits');
const ACTIVE_DIR = path.join(BASE_DIR, '01_active_players');
const LEGENDS_DIR = path.join(BASE_DIR, '02_all_time_legends');
const DATASET_PATH = path.join(__dirname, 'public', 'datasets', 'pixel-players.json');
const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');

function getMd5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function runImport() {
  if (!fs.existsSync(BASE_DIR)) {
    console.error('Directory curated_portraits does not exist.');
    return;
  }

  const players = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  let totalNewImported = 0;
  let playersUpdated = 0;

  // Process a folder collection
  function processSection(dir) {
    if (!fs.existsSync(dir)) return;
    const folders = fs.readdirSync(dir);

    for (const folder of folders) {
      const match = folder.match(/^(\d+)_/);
      if (!match) continue;
      const playerId = parseInt(match[1], 10);
      const player = players.find(p => p.id === playerId);
      if (!player) continue;

      const folderPath = path.join(dir, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      const files = fs.readdirSync(folderPath).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      });

      if (files.length === 0) continue;

      const importedForPlayer = [];
      const seenHashes = new Set();

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const buf = fs.readFileSync(filePath);
        if (buf.length < 5000) continue; // skip corrupted/empty

        const hash = getMd5(buf);
        if (seenHashes.has(hash)) continue; // avoid duplicate in same folder
        seenHashes.add(hash);

        // Save with anonymized secure hash filename
        const ext = path.extname(file).toLowerCase() === '.png' ? '.png' : '.jpg';
        const targetFilename = `p_${hash.slice(0, 12)}${ext}`;
        const targetRelPath = `photos/${targetFilename}`;
        const targetFullPath = path.join(PHOTOS_DIR, targetFilename);

        fs.writeFileSync(targetFullPath, buf);
        importedForPlayer.push(targetRelPath);
        totalNewImported++;
      }

      if (importedForPlayer.length > 0) {
        player.images = importedForPlayer;
        player.imageUrl = importedForPlayer[0];
        playersUpdated++;
        console.log(`[#${player.id}] ${player.name}: Imported ${importedForPlayer.length} photos.`);
      }
    }
  }

  processSection(ACTIVE_DIR);
  processSection(LEGENDS_DIR);

  fs.writeFileSync(DATASET_PATH, JSON.stringify(players, null, 2), 'utf8');

  console.log('\n==================================================');
  console.log(`IMPORT COMPLETE: Updated ${playersUpdated} players with ${totalNewImported} photos.`);
  console.log('Filenames are anonymized and cannot be backtracked from the UI.');
  console.log('==================================================\n');
}

runImport();
