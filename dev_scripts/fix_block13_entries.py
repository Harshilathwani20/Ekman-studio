import json

products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

with open(products_file, 'r') as f:
    products = json.load(f)

# Remove the misaligned b132 entry (which is from block1, not block13)
if 'b132' in products:
    del products['b132']
    print('✓ Removed misaligned b132 entry')

# Rebuild block13 entries correctly
# There are 90 actual PNG files numbered 0001-0090
# Keep the original 10 entries (b1301-b1310) and remove/rebuild the rest

# First remove all block13 entries
b13_to_remove = [k for k in products.keys() if k.startswith('b13')]
for k in b13_to_remove:
    del products[k]

print(f'✓ Removed {len(b13_to_remove)} old block13 entries')

# Now create entries for all 90 images
# Use b1301-b1310 for pages 1-10, then b1311-b1390 for pages 11-90
for i in range(1, 91):
    key = f'b13{i:02d}'
    products[key] = {'image': f'products/block13/BLOCK 13_page-{i:04d}.png'}

print(f'✓ Created 90 new block13 entries (b1301-b1390)')

# Save updated products.json
with open(products_file, 'w') as f:
    json.dump(products, f, indent=2)

print()
print('Summary:')
b13_entries = sorted([k for k in products.keys() if k.startswith('b13')])
print(f'Total block13 entries: {len(b13_entries)}')
print(f'Range: {b13_entries[0]} to {b13_entries[-1]}')
