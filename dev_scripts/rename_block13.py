import os
import json
from pathlib import Path

# Paths
block13_folder = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products\block13'
products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

# Get all image files from block13
image_files = sorted([f for f in os.listdir(block13_folder) if f.endswith('.png')])

# Load products.json
with open(products_file, 'r') as f:
    products = json.load(f)

# Create mapping of old names to new names
old_to_new = {}
rename_operations = []

for i, old_filename in enumerate(image_files, 1):
    new_filename = f'BLOCK 13_page-{i:04d}.png'
    old_to_new[old_filename] = new_filename
    
    old_path = os.path.join(block13_folder, old_filename)
    new_path = os.path.join(block13_folder, new_filename)
    
    rename_operations.append((old_path, new_path))

# Rename all files
for old_path, new_path in rename_operations:
    if os.path.exists(old_path):
        os.rename(old_path, new_path)
        print(f'Renamed: {os.path.basename(old_path)} -> {os.path.basename(new_path)}')

print(f'\n✓ Renamed {len(rename_operations)} files in block13 folder')

# Update products.json with new filenames
updated_count = 0
for key in products:
    image_path = products[key]['image']
    
    # Check if this is a block13 entry
    if 'block13' in image_path:
        # Get the old filename
        old_filename = image_path.split('/')[-1]
        
        # Find the new filename
        if old_filename in old_to_new:
            new_filename = old_to_new[old_filename]
            products[key]['image'] = f'products/block13/{new_filename}'
            updated_count += 1

# Save updated products.json
with open(products_file, 'w') as f:
    json.dump(products, f, indent=2)

print(f'✓ Updated {updated_count} entries in products.json')
print()
print('Sample renamed entries:')
count = 0
for key in products:
    if 'block13' in products[key]['image']:
        print(f'  {key}: {products[key]["image"]}')
        count += 1
        if count >= 5:
            break
