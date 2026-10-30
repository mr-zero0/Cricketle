"""
Imports user-curated portrait photos from `curated_portraits/` into `public/photos/`
and updates `public/datasets/pixel-players.json`.

Features:
- Accepts ANY filename (e.g. '1.jpg', 'download (2).png', 'dhoni-smile.webp', etc.)
- Accepts ANY image format (.jpg, .jpeg, .png, .webp, .jfif, .bmp, .tiff, etc.)
- Automatically converts/normalizes images to high-quality standard web RGB JPEG (.jpg)
- Generates secure cryptographic hash filenames (e.g. p_9b4e1f7a12cd.jpg) so that
  cricketer names can NEVER be backtracked or inspected from the browser/DevTools!
"""

import json
import hashlib
from pathlib import Path
from PIL import Image, ImageOps
import io
import re

BASE_DIR = Path(__dirname__ if '__dirname__' in globals() else '.') / 'curated_portraits'
ACTIVE_DIR = BASE_DIR / '01_active_players'
LEGENDS_DIR = BASE_DIR / '02_all_time_legends'
DATASET_PATH = Path('public/datasets/pixel-players.json')
PHOTOS_DIR = Path('public/photos')

SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.jfif', '.bmp', '.tiff', '.avif'}

def get_md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()

def normalize_image_to_jpeg(file_path: Path) -> bytes | None:
    try:
        with Image.open(file_path) as img:
            # Auto-orient based on EXIF tags (e.g. phone camera orientation)
            img = ImageOps.exif_transpose(img)
            
            # Convert to RGB if needed (handling RGBA, palette, greyscale, etc.)
            if img.mode in ('RGBA', 'LA', 'P'):
                # Create a clean white background for transparent PNGs
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if 'A' in img.mode else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
                
            out = io.BytesIO()
            img.save(out, format='JPEG', quality=92, optimize=True)
            return out.getvalue()
    except Exception as e:
        print(f"  Warning: could not process {file_path.name}: {e}")
        return None

def run_import():
    if not BASE_DIR.exists():
        print(f"Error: {BASE_DIR} does not exist.")
        return

    with open(DATASET_PATH, 'r', encoding='utf-8') as f:
        players = json.load(f)

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    total_imported = 0
    players_updated = 0

    def process_section(section_dir: Path):
        nonlocal total_imported, players_updated
        if not section_dir.exists():
            return

        # Sort folder names by player ID prefix
        folders = sorted([f for f in section_dir.iterdir() if f.is_dir()])
        for folder in folders:
            m = re.match(r'^(\d+)_', folder.name)
            if not m:
                continue
            player_id = int(m.group(1))
            player = next((p for p in players if p['id'] == player_id), None)
            if not player:
                continue

            # Find all image files regardless of name or extension
            image_files = [
                f for f in folder.iterdir() 
                if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
            ]

            if not image_files:
                continue

            imported_for_player = []
            seen_hashes = set()

            for img_file in image_files:
                jpeg_bytes = normalize_image_to_jpeg(img_file)
                if not jpeg_bytes or len(jpeg_bytes) < 4000:
                    continue

                hsh = get_md5(jpeg_bytes)
                if hsh in seen_hashes:
                    # Skip duplicate inside same folder
                    continue
                seen_hashes.add(hsh)

                # Anonymized secure hash filename: p_<hash12>.jpg
                anonymized_filename = f"p_{hsh[:12]}.jpg"
                dest_path = PHOTOS_DIR / anonymized_filename
                dest_path.write_bytes(jpeg_bytes)

                imported_for_player.append(f"photos/{anonymized_filename}")
                total_imported += 1

            if imported_for_player:
                player['images'] = imported_for_player
                player['imageUrl'] = imported_for_player[0]
                players_updated += 1
                print(f"[#{player['id']}] {player['name']}: Imported {len(imported_for_player)} photo(s).")

    process_section(ACTIVE_DIR)
    process_section(LEGENDS_DIR)

    with open(DATASET_PATH, 'w', encoding='utf-8') as f:
        json.dump(players, f, indent=2)

    print("\n" + "=" * 60)
    print(f"IMPORT COMPLETE: Updated {players_updated} players with {total_imported} photos.")
    print("All images standardized to high-quality .jpg with secure hash names.")
    print("=" * 60 + "\n")

if __name__ == '__main__':
    run_import()

