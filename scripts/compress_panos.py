"""
Compress panorama images for web delivery.
Resizes to 4096px wide (maintains 2:1 ratio) and saves as JPEG quality 80.
Original files are kept in a 'panos_original' backup folder.

Usage:
  python scripts/compress_panos.py <panos_folder>

Example:
  python scripts/compress_panos.py clients/neelkanth/tours/showroom/panos
"""
import os
import sys
import shutil
from PIL import Image

TARGET_WIDTH = 4096
JPEG_QUALITY = 80

def compress_panos(panos_dir):
    if not os.path.isdir(panos_dir):
        print(f"Error: {panos_dir} is not a directory")
        sys.exit(1)

    # Create backup
    backup_dir = panos_dir + '_original'
    if not os.path.exists(backup_dir):
        print(f"Backing up originals to {backup_dir}")
        shutil.copytree(panos_dir, backup_dir)
    else:
        print(f"Backup already exists at {backup_dir}, skipping backup.")

    files = [f for f in os.listdir(panos_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
    print(f"Found {len(files)} images to compress.\n")

    for fname in sorted(files):
        fpath = os.path.join(panos_dir, fname)
        original_size = os.path.getsize(fpath) / (1024 * 1024)

        img = Image.open(fpath)
        w, h = img.size
        print(f"  {fname}: {w}x{h} ({original_size:.1f} MB)", end=" → ")

        if w > TARGET_WIDTH:
            ratio = TARGET_WIDTH / w
            new_h = int(h * ratio)
            img = img.resize((TARGET_WIDTH, new_h), Image.LANCZOS)

        # Save as JPEG
        out_path = os.path.splitext(fpath)[0] + '.jpeg'
        img.save(out_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        # Remove original if different extension
        if out_path != fpath and os.path.exists(fpath):
            os.remove(fpath)

        new_size = os.path.getsize(out_path) / (1024 * 1024)
        new_w, new_h = img.size
        print(f"{new_w}x{new_h} ({new_size:.1f} MB)")

    print("\nDone! Images compressed for web delivery.")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/compress_panos.py <panos_folder>")
        sys.exit(1)
    compress_panos(sys.argv[1])
