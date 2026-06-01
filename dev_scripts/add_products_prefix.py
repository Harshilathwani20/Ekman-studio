import json

# Load products.json
products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

with open(products_file, 'r') as f:
    products = json.load(f)

# Add "products/" prefix to paths that don't have it
updated_count = 0
for key in products:
    image_path = products[key]['image']
    if not image_path.startswith('products/'):
        products[key]['image'] = f'products/{image_path}'
        updated_count += 1

# Save updated products back
with open(products_file, 'w') as f:
    json.dump(products, f, indent=2)

print(f'Updated {updated_count} entries with products/ prefix')
print(f'Total entries: {len(products)}')
print()
print('Sample entries after update:')
for i, key in enumerate(list(products.keys())[:15]):
    if i % 3 == 0:
        print(f'  {key}: {products[key]["image"]}')
