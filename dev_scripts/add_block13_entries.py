import json

# Load products.json
products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

with open(products_file, 'r') as f:
    products = json.load(f)

# Add entries for block13 pages 11-90 (since b1301-b1310 already exist)
added_count = 0
for i in range(11, 91):
    key = f'b13{i:02d}'
    if key not in products:
        products[key] = {'image': f'products/block13/BLOCK 13_page-{i:04d}.png'}
        added_count += 1

# Save updated products.json
with open(products_file, 'w') as f:
    json.dump(products, f, indent=2)

print(f'✓ Added {added_count} new block13 entries (b1311-b1390)')
print()
print('Sample of newly added entries:')
for i in [11, 45, 90]:
    key = f'b13{i:02d}'
    print(f'  {key}: {products[key]["image"]}')

print()
print('All block13 entries summary:')
b13_count = len([k for k in products.keys() if k.startswith('b13')])
print(f'  Total block13 entries: {b13_count}')
