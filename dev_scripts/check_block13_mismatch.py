import json
import os
from pathlib import Path

products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'
block13_folder = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products\block13'

# Get files
files = sorted([f for f in os.listdir(block13_folder) if f.endswith('.png')])

# Get products
with open(products_file, 'r') as f:
    products = json.load(f)

b13_entries = sorted([k for k in products.keys() if k.startswith('b13')])

print(f'Files in block13 folder: {len(files)}')
print(f'Entries in products.json: {len(b13_entries)}')
print()

# Find mismatches
print('Checking for mismatches...')
for i, entry in enumerate(b13_entries):
    expected_num = i + 1
    expected_file = f'BLOCK 13_page-{expected_num:04d}.png'
    actual_path = products[entry]['image']
    actual_file = actual_path.split('/')[-1]
    
    if actual_file != expected_file:
        print(f'Entry {entry} expects {expected_file} but points to {actual_file}')
    
    # Also check if file exists
    if not os.path.exists(os.path.join(block13_folder, actual_file)):
        print(f'File missing for entry {entry}: {actual_file}')

print()
print('Verification complete!')
