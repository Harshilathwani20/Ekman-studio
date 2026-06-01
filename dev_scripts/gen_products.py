import os
import json

base = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products'

entries = {}

# block9_1 - 64 files
folder = 'block9_1'
files = sorted(os.listdir(os.path.join(base, folder)))
for i, f in enumerate(files, 1):
    key = f'b91{i:02d}'
    path = f'products/{folder}/{f}'
    entries[key] = {"image": path}
    print(f'  "{key}": {{ "image": "{path}" }},')

print()

# block9_2 - 92 files  
folder = 'block9_2'
files = sorted(os.listdir(os.path.join(base, folder)))
for i, f in enumerate(files, 1):
    key = f'b92{i:02d}'
    path = f'products/{folder}/{f}'
    entries[key] = {"image": path}
    print(f'  "{key}": {{ "image": "{path}" }},')

print(f"\nTotal entries: {len(entries)}")
